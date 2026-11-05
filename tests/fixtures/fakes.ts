// Test-only providers. Product code never imports this file (see CLAUDE.md).
import type { PipelineDeps } from "@/lib/pipeline/context";
import type { LlmProvider, LlmRequest, LlmTask } from "@/lib/providers/llm";
import type { ExtractResult, SearchProvider, SearchQuery, SearchResult } from "@/lib/providers/search";

export type SearchHandler = (query: SearchQuery) => SearchResult[] | Error;

export class FakeSearch implements SearchProvider {
  readonly calls: SearchQuery[] = [];
  constructor(
    private readonly handler: SearchHandler,
    private readonly pages: Record<string, string | Error> = {},
  ) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    this.calls.push(query);
    const out = this.handler(query);
    if (out instanceof Error) throw out;
    return out;
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    const results: ExtractResult[] = [];
    for (const url of urls) {
      const page = this.pages[url];
      if (page instanceof Error) throw page;
      if (page) results.push({ url, rawContent: page });
    }
    return results;
  }
}

type Handler = (request: LlmRequest<unknown>) => unknown;

export class FakeLlm implements LlmProvider {
  readonly calls: LlmRequest<unknown>[] = [];
  constructor(private readonly handlers: Partial<Record<LlmTask, Handler>>) {}

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    this.calls.push(request as LlmRequest<unknown>);
    const handler = this.handlers[request.task];
    if (!handler) throw new Error(`FakeLlm has no handler for task "${request.task}"`);
    let output = handler(request as LlmRequest<unknown>);
    if (output instanceof Error) throw output;
    if (request.task === "draft") output = structuredDraft(output);
    // Validate against the real schema so fixtures can't drift from what Claude is constrained to return.
    return request.schema.parse(output);
  }

  callsFor(task: LlmTask) {
    return this.calls.filter((c) => c.task === task);
  }
}

export const FIXED_NOW = new Date("2026-11-03T12:00:00Z");

export function deps(search: SearchProvider, llm: LlmProvider): PipelineDeps {
  return { search, llm, now: () => FIXED_NOW };
}

export function result(url: string, title: string, text: string, publishedDate: string | null = null): SearchResult {
  return { url, title, content: text.slice(0, 300), rawContent: text, publishedDate, score: 0.8 };
}

/** Finds the S-id the pipeline assigned to a URL by reading the prompt (ids are assigned in order). */
export function sourceIdFor(prompt: string, url: string): string {
  const match = new RegExp(`<untrusted_source id="(S\\d+)" url="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(prompt);
  if (!match) throw new Error(`Source ${url} not present in prompt`);
  return match[1];
}

/**
 * Lets fixtures write a draft as one plain body: splits it into the structured parts the drafter
 * returns (greeting, opening, insight, value, cta, signoff) so assembleBody reproduces the same text.
 */
export function structuredDraft(output: unknown): unknown {
  const o = output as Record<string, unknown>;
  if (typeof o !== "object" || o === null || typeof o.body !== "string" || "greeting" in o) return output;
  const parts = (o.body as string).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const greeting = parts.shift() ?? "";
  const signoff = parts.length > 1 ? parts.pop()! : "";
  const [opening = "", insight = "", value = "", ...rest] = parts;
  const { body: _body, ...restOutput } = o;
  void _body;
  return {
    alternateSubjects: ["Alternate subject one", "Alternate subject two"],
    rationale: ["Led with the strongest verified finding."],
    postscript: null,
    ...restOutput,
    greeting,
    opening,
    insight,
    value,
    cta: rest.join("\n\n"),
    signoff,
  };
}
