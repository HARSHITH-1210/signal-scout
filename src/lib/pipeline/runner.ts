import { getConfig, logError } from "../config";
import * as repo from "../db/repo";
import { PipelineError, ProviderError } from "../errors";
import { AnthropicProvider, type LlmProvider, type LlmRequest } from "../providers/llm";
import { OpenRouterProvider } from "../providers/openrouter";
import { TavilyProvider, type SearchProvider, type SearchQuery } from "../providers/search";
import type { Clarification, Draft, DraftKind, Identity, ProspectInput, RunDocument, StageName, StageStatus } from "../types";
import type { PipelineDeps, StageContext } from "./context";
import { plural, selectHook } from "./scoring";
import { badNewsHold } from "./sensitive";
import { draftConfidence, draftExpiresAt } from "./confidence";
import { checkContactRules, type ContactSubject } from "./contacts";
import { buildGuardInput, generateDraft, guardDraft } from "./stages/draft";
import { generateRevision } from "./stages/revise";
import { extractSignals } from "./stages/extractSignals";
import { research } from "./stages/research";
import { resolveIdentity } from "./stages/resolveIdentity";
import { verifySignals } from "./stages/verify";
import { validateProspect } from "./validate";
import { mentionsCompany } from "./evidence";
import { csvRowText } from "../documents/parse";

/**
 * full           – new run from the top
 * from_identity  – rep added details after an ambiguous match; re-resolve identity
 * from_research  – rep picked a candidate; identity is confirmed, continue with research
 * draft_only     – regenerate the personalised draft from persisted research
 * role_based     – rep explicitly asked for a non-personalised draft after insufficient research
 */
export type RunMode = "full" | "from_identity" | "from_research" | "draft_only" | "role_based";

// Real providers, constructed lazily so a missing key fails the stage that needs it with a clear message.
class LazySearch implements SearchProvider {
  private inner: TavilyProvider | null = null;
  private get provider() {
    return (this.inner ??= new TavilyProvider());
  }
  search(q: SearchQuery) {
    return this.provider.search(q);
  }
  extract(urls: string[]) {
    return this.provider.extract(urls);
  }
}

/** Builds the configured LLM backend (LLM_PROVIDER, or inferred from which key is set). */
export function createLlmProvider(): LlmProvider {
  const provider = getConfig().llmProvider;
  if (provider === "openrouter") return new OpenRouterProvider();
  if (provider === "anthropic") return new AnthropicProvider();
  throw new ProviderError("anthropic", "config", 'LLM_PROVIDER must be "anthropic" or "openrouter". Fix it in .env.local and restart.');
}

class LazyLlm implements LlmProvider {
  private inner: LlmProvider | null = null;
  generate<T>(request: LlmRequest<T>) {
    return (this.inner ??= createLlmProvider()).generate(request);
  }
}

export function createDefaultDeps(): PipelineDeps {
  return { search: new LazySearch(), llm: new LazyLlm(), now: () => new Date() };
}

function userMessage(error: unknown, stage: StageName): string {
  if (error instanceof PipelineError || error instanceof ProviderError) return error.message;
  return `Unexpected error during "${stage}". Details were logged on the server.`;
}

class StageRunner {
  readonly ctx: StageContext;
  private stage: StageName = "validate";
  private readonly startedAt = Date.now();

  constructor(
    readonly runId: string,
    deps: PipelineDeps,
  ) {
    this.ctx = {
      runId,
      deps,
      sender: repo.getSenderProfile(),
      emit: (stage: StageName, status: StageStatus, message: string, detail?: Record<string, unknown>) =>
        repo.addEvent(runId, stage, status, message, detail),
    };
  }

  async step<T>(stage: StageName, startMessage: string, fn: () => Promise<T>): Promise<T> {
    this.stage = stage;
    repo.updateRun(this.runId, { currentStage: stage, status: "running" });
    this.ctx.emit(stage, "running", startMessage);
    try {
      return await fn();
    } catch (error) {
      throw error instanceof PipelineError ? error : new PipelineError(stage, userMessage(error, stage), error);
    }
  }

  done(stage: StageName, status: "succeeded" | "warning", message: string, detail?: Record<string, unknown>) {
    this.ctx.emit(stage, status, message, detail);
  }

  skip(stages: StageName[], reason: string) {
    for (const s of stages) this.ctx.emit(s, "skipped", reason);
  }

  get currentStage() {
    return this.stage;
  }

  /** Ends this execution: records the outcome and adds the time actually spent working. */
  finish(patch: repo.RunPatch) {
    repo.addActiveTime(this.runId, Date.now() - this.startedAt);
    repo.updateRun(this.runId, { ...patch, completedAt: new Date().toISOString() });
  }
}

const AFTER_IDENTITY: StageName[] = ["research", "extract_signals", "verify", "rank_hook", "draft", "guard"];

/** Loads a run's attached documents as evidence text. A CSV contributes only the chosen row. */
export function loadRunDocuments(docs: RunDocument[]): { texts: { name: string; text: string }[]; missing: string[] } {
  const texts: { name: string; text: string }[] = [];
  const missing: string[] = [];
  for (const ref of docs) {
    const doc = repo.getDocument(ref.documentId);
    if (!doc) {
      missing.push(ref.name);
      continue;
    }
    if (doc.kind === "csv" && doc.rows && doc.csv) {
      const row = ref.rowIndex !== null ? doc.rows[ref.rowIndex] : undefined;
      if (row) texts.push({ name: `${doc.name} (row ${ref.rowIndex! + 1})`, text: csvRowText(doc.csv.headers, row) });
      else missing.push(`${ref.name} (row ${(ref.rowIndex ?? 0) + 1})`);
    } else {
      texts.push({ name: doc.name, text: doc.text });
    }
  }
  return { texts, missing };
}

/** Checks the rep's contact list; a match stops the run before any (more) research or drafting. */
function holdForContact(runner: StageRunner, subject: ContactSubject, overridden: boolean, remaining: StageName[], finishStage?: StageName): boolean {
  const hold = checkContactRules(subject, repo.getContactRules(), overridden);
  if (!hold) return false;
  if (finishStage) runner.done(finishStage, "warning", "Matched your contact list");
  const message =
    hold.kind === "do_not_contact"
      ? `${hold.match} is on your do-not-contact list. Nothing more was researched, and nothing can be sent.`
      : `Existing relationship (${hold.match})${hold.note ? `: ${hold.note}` : ""}. Check with the account owner before reaching out.`;
  repo.updateRun(runner.runId, { hold, limitations: [message] });
  runner.skip(remaining, hold.kind === "do_not_contact" ? "Skipped: do not contact" : "Skipped: existing relationship, waiting for you");
  runner.finish({ status: "held", error: null });
  return true;
}

/** Executes the pipeline for one run. Every outcome, including failure, is persisted. */
export async function runPipeline(runId: string, deps: PipelineDeps, mode: RunMode = "full"): Promise<void> {
  const record = repo.getRun(runId);
  if (!record) throw new Error(`Run ${runId} not found`);
  const runner = new StageRunner(runId, deps);
  const previousDraft = repo.latestDraft(runId);
  repo.claimRun(runId);

  try {
    if (mode === "draft_only" || mode === "role_based") {
      await draftAndGuard(runner, mode === "role_based" ? "role_based" : "personalised");
      return;
    }

    let prospect = record.prospect;
    let identity: Identity | null = record.identity;
    const limitations: string[] = [];

    if (mode === "full") {
      prospect = await runner.step("validate", "Checking prospect details", async () => {
        const result = validateProspect(prospect, { allowEmpty: record.documents.length > 0 });
        if (!result.ok) throw new PipelineError("validate", `Invalid input: ${Object.values(result.errors).join("; ")}`);
        return result.value;
      });
      const ids = [
        prospect.name && "name",
        prospect.company && "company",
        prospect.companyWebsite && "website",
        prospect.linkedinUrl && "LinkedIn URL",
        prospect.role && "role",
        prospect.notes && "notes",
        record.documents.length > 0 && plural(record.documents.length, "document", "documents"),
      ].filter(Boolean);
      runner.done("validate", "succeeded", `Researching from: ${ids.join(", ")}`);
      if (holdForContact(runner, { email: prospect.email, company: prospect.company, website: prospect.companyWebsite }, record.hold?.overridden === true, ["resolve_identity", ...AFTER_IDENTITY])) return;
    }

    if (prospect.linkedinUrl)
      limitations.push("LinkedIn is not scraped (login-walled, against its terms). Only publicly indexed pages were used.");

    if (mode === "full" || mode === "from_identity") {
      const documents = loadRunDocuments(record.documents);
      if (documents.missing.length) limitations.push(`These attached documents were deleted before the run and were skipped: ${documents.missing.join(", ")}.`);
      const result = await runner.step("resolve_identity", "Searching for the prospect", () => resolveIdentity(runner.ctx, prospect, documents.texts));
      identity = result.identity;
      limitations.push(...result.limitations);
      repo.replaceSources(runId, result.sources);
      repo.updateRun(runId, { identity, researchLog: result.log, limitations });

      if (identity.status === "ambiguous") {
        runner.done("resolve_identity", "warning", `${plural(identity.candidates.length, "possible match", "possible matches")}. Waiting for you to pick one.`, {
          candidates: identity.candidates.length,
        });
        runner.skip(AFTER_IDENTITY, "Paused until the prospect is clarified");
        runner.finish({ status: "needs_clarification", currentStage: "resolve_identity", error: null });
        return;
      }
      if (
        identity.status === "resolved" &&
        holdForContact(runner, { email: prospect.email, company: identity.resolvedCompany, domain: identity.companyDomain }, record.hold?.overridden === true, AFTER_IDENTITY, "resolve_identity")
      )
        return;
      if (identity.status === "not_found") {
        runner.done("resolve_identity", "warning", "Could not confirm who this prospect is from public sources.");
        runner.skip(AFTER_IDENTITY, "Skipped: identity not confirmed");
        runner.finish({ status: "insufficient_research", currentStage: "resolve_identity", limitations, error: null });
        return;
      }
      runner.done(
        "resolve_identity",
        identity.personConfirmed ? "succeeded" : "warning",
        identity.personConfirmed
          ? `Matched ${identity.resolvedName}${identity.resolvedRole ? `, ${identity.resolvedRole}` : ""} at ${identity.resolvedCompany}`
          : `Company confirmed (${identity.resolvedCompany}); person not visible in public sources`,
      );
    } else {
      limitations.push(...record.limitations);
    }

    if (!identity || identity.status !== "resolved") throw new PipelineError("resolve_identity", "Identity is not resolved.");
    const resolved = identity;

    const researched = await runner.step("research", "Searching news, funding, hiring, interviews and priorities", () =>
      research(runner.ctx, resolved, prospect, repo.listSources(runId)),
    );
    repo.replaceSources(runId, researched.sources);
    const researchLog = [...(repo.getRun(runId)?.researchLog ?? []), ...researched.log];
    if (researched.failedQueries > 0)
      limitations.push(`${researched.failedQueries} of ${researched.log.length} research searches failed, so results may be incomplete.`);
    repo.updateRun(runId, { researchLog, limitations });
    runner.done(
      "research",
      researched.failedQueries > 0 ? "warning" : "succeeded",
      `${plural(researched.sources.length, "source", "sources")} collected${researched.failedQueries ? `, ${plural(researched.failedQueries, "search", "searches")} failed` : ""}`,
    );

    const candidates = await runner.step("extract_signals", "Extracting candidate signals", () =>
      extractSignals(runner.ctx, prospect, resolved, researched.sources),
    );
    repo.replaceSignals(runId, candidates);
    runner.done("extract_signals", "succeeded", `${plural(candidates.length, "candidate finding", "candidate findings")} proposed`);

    const verified = await runner.step("verify", "Verifying evidence, freshness and consistency", () =>
      verifySignals(runner.ctx, candidates, researched.sources, resolved, prospect),
    );
    const counts = {
      verified: verified.signals.filter((s) => s.status === "verified").length,
      rejected: verified.signals.filter((s) => s.status === "rejected").length,
      conflicting: verified.signals.filter((s) => s.status === "conflicting").length,
      stale: verified.signals.filter((s) => s.freshness === "stale").length,
    };
    if (counts.conflicting > 0) limitations.push(`${plural(counts.conflicting, "finding conflicts", "findings conflict")} with other sources, so none of them is stated as fact.`);
    if (counts.stale > 0) limitations.push(`${plural(counts.stale, "finding is", "findings are")} too old to use as a hook for their kind of signal.`);
    if ((resolved.resolvedName ?? prospect.name) && !verified.signals.some((s) => s.about === "person" && s.status === "verified"))
      limitations.push("No verified activity by the person themselves was found, so any hook is about the company.");
    const held = badNewsHold(verified.signals);
    if (held.length > 0)
      limitations.push(`On hold: ${plural(held.length, "finding reports", "findings report")} recent bad news (${held[0].claim.replace(/\.$/, "")}). It's never used in the draft. Decide whether now is the right time to reach out before approving.`);

    const selection = selectHook(verified.signals);
    repo.replaceSignals(runId, selection.scored);
    runner.done(
      "verify",
      counts.conflicting > 0 || counts.rejected > 0 ? "warning" : "succeeded",
      `${counts.verified} verified, ${counts.rejected} rejected, ${counts.conflicting} conflicting, ${counts.stale} stale`,
      counts,
    );

    await runner.step("rank_hook", "Scoring signals by relevance, freshness and source reliability", async () => undefined);
    if (!selection.hook) {
      limitations.push(...selection.reasons);
      repo.updateRun(runId, { hook: null, limitations });
      runner.done("rank_hook", "warning", "No signal is strong enough for a personalised hook");
      runner.skip(["draft", "guard"], "Skipped: no verified hook. A role-based draft can be requested explicitly.");
      runner.finish({ status: "insufficient_research", error: null });
      return;
    }
    const hookSignal = selection.scored.find((s) => s.id === selection.hook!.signalId)!;
    if (selection.hook.staleCaveat) limitations.push("The selected hook is stale for its kind of signal; the draft must not present it as recent.");
    repo.updateRun(runId, { hook: selection.hook, limitations });
    runner.done(
      "rank_hook",
      selection.hook.staleCaveat ? "warning" : "succeeded",
      `Hook: ${hookSignal.type.replace(/_/g, " ")} (score ${selection.hook.score.toFixed(2)})`,
    );

    await draftAndGuard(runner, "personalised");
  } catch (error) {
    const stage = error instanceof PipelineError ? error.stage : runner.currentStage;
    const message = userMessage(error, stage);
    logError(`run ${runId} failed at ${stage}`, error instanceof PipelineError && error.cause ? error.cause : error);
    runner.ctx.emit(stage, "failed", message);
    // A failed regeneration must not discard a draft the rep already has.
    if ((mode === "draft_only" || mode === "role_based") && previousDraft) {
      runner.finish({ status: "awaiting_review", error: `Draft regeneration failed: ${message}` });
    } else {
      runner.finish({ status: "failed", error: message });
    }
  }
}

async function draftAndGuard(runner: StageRunner, kind: DraftKind) {
  const runId = runner.runId;
  const record = repo.getRun(runId)!;
  const signals = repo.listSignals(runId);
  const sources = repo.listSources(runId);

  const generated = await runner.step("draft", kind === "personalised" ? "Drafting from the selected hook" : "Drafting a role-based message", () =>
    generateDraft(runner.ctx, {
      kind,
      prospect: record.prospect,
      identity: record.identity,
      hook: kind === "personalised" ? record.hook : null,
      signals,
      sources,
      sellerDocuments: repo.listDocuments("sender").map((d) => ({ name: d.name, text: d.text })),
    }),
  );
  runner.done("draft", "succeeded", `Draft written (${generated.draft.body.split(/\s+/).length} words, ${plural(generated.draft.signalIdsUsed.length, "finding", "findings")} used)`);

  const guard = await runner.step("guard", "Checking length, tone, links and claims", () =>
    guardDraft(runner.ctx, generated.draft, generated.guardInput),
  );
  const errors = guard.issues.filter((i) => i.severity === "error").length;
  const warnings = guard.issues.length - errors;
  const hookSignal = generated.guardInput.hookSignalId ? signals.find((s) => s.id === generated.guardInput.hookSignalId) : undefined;
  const notes = {
    ...generated.draft.notes,
    confidence: draftConfidence(kind, hookSignal, record.identity, guard.issues),
    expiresAt: draftExpiresAt(runner.ctx.deps.now(), kind, hookSignal?.type ?? null),
  };
  repo.addDraft(runId, { ...generated.draft, notes, author: "ai", guard });
  runner.done(
    "guard",
    guard.issues.length ? "warning" : "succeeded",
    guard.issues.length ? `${plural(errors, "issue", "issues")} to fix and ${plural(warnings, "suggestion", "suggestions")} for the reviewer` : "No issues found. Ready for human review.",
  );
  runner.finish({ status: "awaiting_review", error: null, currentStage: "guard", approvedVersion: null });
}

export type ReviseResult =
  | { ok: true; draft: Draft; reply: string; changed: boolean }
  | { ok: false; status: 404 | 409 | 502; error: string; latest?: Draft };

/**
 * Applies a rep's free-text instruction to the latest draft with the LLM (or answers their question).
 * A changed email is saved as a new version after the full guard, claim audit included, and needs a
 * fresh approval. Nothing is sent. A failed call leaves the draft untouched.
 */
export async function reviseRunDraft(
  runId: string,
  request: { instruction: string; subject: string; body: string; baseVersion: number },
  deps: PipelineDeps = queue().depsFactory(),
): Promise<ReviseResult> {
  const record = repo.getRun(runId);
  if (!record) return { ok: false, status: 404, error: "Run not found." };
  const current = repo.latestDraft(runId);
  if (!current) return { ok: false, status: 409, error: "There is no draft to edit yet." };
  if (record.status !== "awaiting_review" && record.status !== "approved") return { ok: false, status: 409, error: "Drafts can only be edited once the run is ready for review." };
  const stale = (latest: Draft): ReviseResult => ({
    ok: false,
    status: 409,
    error: `This draft changed while you were editing (now version ${latest.version}). Review the newer version first.`,
    latest,
  });
  if (request.baseVersion !== current.version) return stale(current);

  const ctx: StageContext = {
    runId,
    deps,
    sender: repo.getSenderProfile(),
    emit: (stage, status, message, detail) => repo.addEvent(runId, stage, status, message, detail),
  };
  const signals = repo.listSignals(runId);
  const sources = repo.listSources(runId);
  const sellerDocuments = repo.listDocuments("sender").map((d) => ({ name: d.name, text: d.text }));
  const base = { kind: current.kind, prospect: record.prospect, identity: record.identity, hook: current.kind === "personalised" ? record.hook : null, signals, sources, sellerDocuments };

  try {
    const revision = await generateRevision(ctx, { ...base, instruction: request.instruction, subject: request.subject, body: request.body });
    const changed = revision.outcome === "revision" && Boolean(revision.subject && revision.body) && (revision.subject !== current.subject || revision.body !== current.body);
    if (!changed) {
      ctx.emit("draft", "succeeded", "Answered your question; the draft is unchanged.");
      return { ok: true, draft: current, reply: revision.reply, changed: false };
    }

    // Facts the rep states in the instruction count as theirs, like their notes; the audit still checks everything else.
    const repNotes = [record.prospect.notes, `Rep's edit instruction: ${request.instruction}`].filter(Boolean).join(" | ");
    const draft = { subject: revision.subject, body: revision.body, signalIdsUsed: revision.signalIdsUsed };
    const guard = await guardDraft(ctx, draft, buildGuardInput({ ...base, repNotes }, draft.signalIdsUsed));

    // The model call takes a while; refuse to overwrite a version saved meanwhile in another tab.
    const latest = repo.latestDraft(runId);
    if (latest && latest.version !== current.version) return stale(latest);

    const hookSignal = current.kind === "personalised" ? signals.find((s) => s.id === record.hook?.signalId) : undefined;
    // The expiry stays with the research: rewording doesn't make old news fresh.
    const notes = {
      alternateSubjects: current.notes?.alternateSubjects ?? [],
      rationale: current.notes?.rationale ?? [],
      ...(current.notes?.expiresAt ? { expiresAt: current.notes.expiresAt } : {}),
      confidence: draftConfidence(current.kind, hookSignal, record.identity, guard.issues),
      revision: { instruction: request.instruction, reply: revision.reply, fromVersion: current.version },
    };
    const saved = repo.addDraft(runId, { ...draft, kind: current.kind, author: "ai", guard, recipientHint: current.recipientHint, notes });
    // Any change after approval needs a fresh approval.
    repo.updateRun(runId, { status: "awaiting_review", approvedVersion: null, error: null });
    ctx.emit("guard", guard.issues.length ? "warning" : "succeeded", `Version ${saved.version} rewritten from your instruction`);
    return { ok: true, draft: saved, reply: revision.reply, changed: true };
  } catch (error) {
    const message = userMessage(error, "draft");
    logError(`revise draft for run ${runId}`, error);
    ctx.emit("draft", "warning", `Edit with AI failed, the draft is unchanged: ${message}`);
    return { ok: false, status: 502, error: `The draft wasn't changed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// In-process queue. The pipeline runs in the background of the long-lived Node server.

type QueueState = { active: number; pending: { runId: string; mode: RunMode }[]; depsFactory: () => PipelineDeps };
const MAX_CONCURRENT = 2;

function queue(): QueueState {
  const g = globalThis as typeof globalThis & { __signalScoutQueue?: QueueState };
  return (g.__signalScoutQueue ??= { active: 0, pending: [], depsFactory: createDefaultDeps });
}

/** Lets scripts/tests substitute providers. Product code never calls this. */
export function setDepsFactory(factory: () => PipelineDeps) {
  queue().depsFactory = factory;
}

function pump() {
  const q = queue();
  while (q.active < MAX_CONCURRENT && q.pending.length > 0) {
    const job = q.pending.shift()!;
    q.active++;
    runPipeline(job.runId, q.depsFactory(), job.mode)
      .catch((error) => logError(`run ${job.runId} crashed`, error))
      .finally(() => {
        q.active--;
        pump();
      });
  }
}

export function enqueueRun(runId: string, mode: RunMode = "full") {
  repo.updateRun(runId, { status: "queued", error: null, completedAt: null });
  queue().pending.push({ runId, mode });
  pump();
}

/** Applies a rep's clarification to an ambiguous run and returns the mode to resume with. */
export function applyClarification(runId: string, clarification: Clarification): { ok: true; mode: RunMode } | { ok: false; error: string } {
  const record = repo.getRun(runId);
  if (!record) return { ok: false, error: "Run not found." };
  if (record.status !== "needs_clarification" || !record.identity) return { ok: false, error: "This run is not waiting for clarification." };

  const clarifications = [...record.clarifications, clarification];
  if (clarification.candidateIndex !== undefined) {
    const candidate = record.identity.candidates[clarification.candidateIndex];
    if (!candidate) return { ok: false, error: "That candidate does not exist." };
    const prospect: ProspectInput = {
      ...record.prospect,
      company: candidate.company ?? record.prospect.company ?? (!record.prospect.name ? candidate.name : undefined),
      role: candidate.role ?? record.prospect.role,
    };
    // Candidates can be companies (when no person was named); only treat the name as a person when it is one.
    const isCompanyCandidate = !record.prospect.name && (!candidate.company || candidate.name === candidate.company);
    const resolvedName = isCompanyCandidate ? null : (record.prospect.name ?? candidate.name);
    const identity: Identity = {
      status: "resolved",
      resolvedName,
      resolvedRole: candidate.role,
      resolvedCompany: candidate.company ?? record.prospect.company ?? (isCompanyCandidate ? candidate.name : null),
      companyDomain: null,
      companyDescription: candidate.description,
      reasoning: `Confirmed by the rep from ${record.identity.candidates.length} candidates.`,
      evidenceUrls: candidate.evidenceUrl ? [candidate.evidenceUrl] : [],
      candidates: [],
      personConfirmed: Boolean(resolvedName && candidate.evidenceUrl),
      confirmedByUser: true,
    };
    // Identity search gathered pages about every candidate. Keep only what belongs to the chosen one,
    // so research never verifies a fact about the person or company the rep just ruled out.
    const otherEvidence = new Set(record.identity.candidates.filter((c) => c !== candidate).map((c) => c.evidenceUrl).filter(Boolean));
    const before = repo.listSources(runId);
    const kept = before.filter((s) => {
      if (s.origin === "prospect_document") return true;
      if (s.url === candidate.evidenceUrl) return true;
      if (otherEvidence.has(s.url)) return false;
      return identity.resolvedCompany ? mentionsCompany(`${s.title}\n${s.url}\n${s.text}`, identity.resolvedCompany, null) : false;
    });
    repo.replaceSources(runId, kept);
    repo.updateRun(runId, { prospect, identity, clarifications });
    repo.addEvent(
      runId,
      "resolve_identity",
      "succeeded",
      `Rep confirmed: ${candidate.name}${candidate.company ? ` at ${candidate.company}` : ""}. Set aside ${plural(before.length - kept.length, "source", "sources")} about other matches.`,
    );
    return { ok: true, mode: "from_research" };
  }

  const prospect: ProspectInput = {
    ...record.prospect,
    company: clarification.company ?? record.prospect.company,
    role: clarification.role ?? record.prospect.role,
    linkedinUrl: clarification.linkedinUrl ?? record.prospect.linkedinUrl,
    companyWebsite: clarification.companyWebsite ?? record.prospect.companyWebsite,
    notes: [record.prospect.notes, clarification.notes].filter(Boolean).join(" | ") || undefined,
  };
  repo.updateRun(runId, { prospect, clarifications, identity: null });
  repo.addEvent(runId, "resolve_identity", "running", "Rep added details; re-resolving identity");
  return { ok: true, mode: "from_identity" };
}
