import * as repo from "../db/repo";
import { ProviderError, type ProviderErrorKind, type ProviderName } from "../errors";
import type { Degradation, StageName } from "../types";
import { isDown, recordFailure, recordSuccess, shouldFailOver } from "./health";
import type { LlmProvider, LlmRequest, LlmTask } from "./llm";
import type { PageReader } from "./reader";
import type { ExtractResult, SearchProvider, SearchQuery, SearchResult } from "./search";

/**
 * Per-run audit trail for external calls. The runner sets the scope (run and stage) as it moves;
 * chains record every attempt, skip and fallback here, and collect what the run had to degrade.
 */
export class CallRecorder {
  runId: string | null = null;
  stage: StageName | null = null;
  /** Epoch ms after which no new provider call starts. */
  deadlineAt: number | null = null;
  private degradations: Degradation[] = [];

  scope(runId: string | null, stage: StageName | null) {
    this.runId = runId;
    this.stage = stage;
  }

  record(call: { task: string; provider: string; model: string | null; outcome: "ok" | "error" | "skipped"; errorKind?: string | null; message?: string | null; fallbackFrom?: string | null; durationMs: number }) {
    repo.addProviderCall({
      runId: this.runId,
      stage: this.stage,
      task: call.task,
      provider: call.provider,
      model: call.model,
      outcome: call.outcome,
      errorKind: call.errorKind ?? null,
      message: call.message ?? null,
      fallbackFrom: call.fallbackFrom ?? null,
      durationMs: call.durationMs,
    });
  }

  degrade(code: Degradation["code"], message: string) {
    if (!this.stage) return;
    if (this.degradations.some((d) => d.code === code && d.stage === this.stage)) return;
    this.degradations.push({ stage: this.stage, code, message });
  }

  /** Degradations collected since the last drain (the runner persists them on the run). */
  drain(): Degradation[] {
    const out = this.degradations;
    this.degradations = [];
    return out;
  }

  checkDeadline(provider: ProviderName) {
    if (this.deadlineAt !== null && Date.now() > this.deadlineAt)
      throw new ProviderError(provider, "unavailable", "This run hit its 20-minute time limit, so no further calls were made.");
  }
}

const FAULT_KINDS: Record<string, ProviderErrorKind> = { quota: "quota", down: "unavailable", auth: "auth", invalid: "invalid_output", slow: "rate_limit" };

/** Parses FAULT_INJECT ("tavily:quota,openrouter:down") into simulated failures. Exported for tests. */
export function parseFaults(spec: string | null): Map<string, ProviderErrorKind> {
  const faults = new Map<string, ProviderErrorKind>();
  for (const part of (spec ?? "").split(",")) {
    const [name, kind] = part.trim().toLowerCase().split(":");
    if (name && kind && FAULT_KINDS[kind]) faults.set(name, FAULT_KINDS[kind]);
  }
  return faults;
}

export interface ChainEntry<T> {
  name: ProviderName;
  model?: string | null;
  /** Builds the client; throws a config ProviderError when its key is missing (the entry is then skipped). */
  create: () => T;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Tries each provider in order. Skips ones the circuit breaker has marked down or that aren't
 * configured; fails over on anything but a config error; records every attempt. Throws only when
 * every provider is exhausted, with each one's reason in the message.
 */
async function runChain<T, R>(
  entries: { entry: ChainEntry<T>; instance: () => T | null }[],
  task: string,
  recorder: CallRecorder,
  faults: Map<string, ProviderErrorKind>,
  call: (instance: T) => Promise<R>,
  onFallback: (servedBy: string, firstFailure: string) => void,
): Promise<{ result: R; servedBy: ProviderName }> {
  const reasons: string[] = [];
  let firstFailed: string | null = null;
  let lastError: ProviderError | null = null;
  let configError: ProviderError | null = null;
  for (const { entry, instance } of entries) {
    const health = isDown(entry.name);
    if (health.down) {
      recorder.record({ task, provider: entry.name, model: entry.model ?? null, outcome: "skipped", message: `Down until ${health.until}`, durationMs: 0 });
      reasons.push(`${entry.name} is paused until ${new Date(health.until!).toUTCString()} (${health.reason ?? "earlier failures"})`);
      firstFailed ??= entry.name;
      continue;
    }
    let client: T | null;
    try {
      client = instance();
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "config") {
        configError ??= error; // not set up: skip, and report it only if nothing else was available
        continue;
      }
      throw error;
    }
    if (!client) continue;
    const started = Date.now();
    try {
      recorder.checkDeadline(entry.name);
      const fault = faults.get(entry.name);
      if (fault) throw new ProviderError(entry.name, fault, `Simulated ${fault.replace("_", " ")} for ${entry.name} (FAULT_INJECT).`);
      const result = await call(client);
      recordSuccess(entry.name);
      recorder.record({ task, provider: entry.name, model: entry.model ?? null, outcome: "ok", fallbackFrom: firstFailed, durationMs: Date.now() - started });
      if (firstFailed) onFallback(entry.name, reasons[0] ?? firstFailed);
      return { result, servedBy: entry.name };
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError(entry.name, "unavailable", `${entry.name} failed: ${describe(error)}`);
      recorder.record({ task, provider: entry.name, model: entry.model ?? null, outcome: "error", errorKind: providerError.kind, message: providerError.message, durationMs: Date.now() - started });
      if (/time limit/.test(providerError.message)) throw providerError;
      recordFailure(entry.name, providerError);
      if (!shouldFailOver(providerError)) throw providerError;
      reasons.push(`${entry.name}: ${providerError.message}`);
      firstFailed ??= entry.name;
      lastError = providerError;
    }
  }
  if (reasons.length === 0 && configError) throw configError;
  const kind: ProviderErrorKind = lastError?.kind === "quota" || reasons.every((r) => /quota|paused|limit/i.test(r)) ? "quota" : (lastError?.kind ?? "unavailable");
  throw new ProviderError(lastError?.provider ?? entries[0]?.entry.name ?? "openrouter", kind, reasons.length ? reasons.join(" · ") : "No provider is configured for this step.");
}

function lazy<T>(entry: ChainEntry<T>) {
  let built: T | null = null;
  return { entry, instance: () => (built ??= entry.create()) };
}

/** LLM fallback chain: primary model, then each other configured provider. */
export class LlmChain implements LlmProvider {
  private readonly entries: ReturnType<typeof lazy<LlmProvider>>[];
  private readonly servedBy = new Map<LlmTask, ProviderName>();

  constructor(
    entries: ChainEntry<LlmProvider>[],
    private readonly recorder: CallRecorder,
    private readonly faults = new Map<string, ProviderErrorKind>(),
  ) {
    this.entries = entries.map(lazy);
  }

  /** Which provider served a task last, so an audit can prefer a different one. */
  served(task: LlmTask): ProviderName | null {
    return this.servedBy.get(task) ?? null;
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    // An independent check (e.g. the claim audit of a draft) goes to a different provider when there is one.
    const avoid = request.independentOf ? this.servedBy.get(request.independentOf) : undefined;
    const ordered = avoid ? [...this.entries.filter((e) => e.entry.name !== avoid), ...this.entries.filter((e) => e.entry.name === avoid)] : this.entries;
    const { result, servedBy } = await runChain(ordered, request.task, this.recorder, this.faults, (llm) => llm.generate(request), (name, why) =>
      this.recorder.degrade("llm_fallback", `${request.task.replace(/_/g, " ")} was handled by ${name} because ${why}.`),
    );
    this.servedBy.set(request.task, servedBy);
    return result;
  }
}

/** Search fallback chain (Tavily → Exa → GDELT) with a separate page-reader chain (Tavily → Exa → Jina → direct). */
export class SearchChain implements SearchProvider {
  private readonly searchers: ReturnType<typeof lazy<SearchProvider>>[];
  private readonly readers: ReturnType<typeof lazy<PageReader>>[];

  constructor(
    searchers: ChainEntry<SearchProvider>[],
    readers: ChainEntry<PageReader>[],
    private readonly recorder: CallRecorder,
    private readonly faults = new Map<string, ProviderErrorKind>(),
  ) {
    this.searchers = searchers.map(lazy);
    this.readers = readers.map(lazy);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const { result } = await runChain(this.searchers, "search", this.recorder, this.faults, (s) => s.search(query), (name, why) =>
      this.recorder.degrade("search_fallback", `Search used ${name} because ${why}.`),
    );
    return result;
  }

  async searchIndependent(query: SearchQuery): Promise<{ results: SearchResult[]; provider: string } | null> {
    const others = this.searchers.slice(1);
    if (others.length === 0) return null;
    try {
      const { result, servedBy } = await runChain(others, "corroborate", this.recorder, this.faults, (s) => s.search(query), () => undefined);
      return { results: result, provider: servedBy };
    } catch {
      return null; // corroboration is a bonus check: its failure never fails the run
    }
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    if (urls.length === 0) return [];
    const { result } = await runChain(this.readers, "read_page", this.recorder, this.faults, (r) => r.extract(urls), (name, why) =>
      this.recorder.degrade("reader_fallback", `Pages were read with ${name} because ${why}.`),
    );
    return result;
  }
}
