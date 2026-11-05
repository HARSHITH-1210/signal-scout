import { z } from "zod";
import { getConfig, redact } from "../config";
import { ProviderError } from "../errors";
import { readJsonCapped, ResponseTooLargeError } from "./http";

export interface SearchQuery {
  query: string;
  topic?: "general" | "news";
  maxResults?: number;
  /** Only return results published on/after this date (YYYY-MM-DD). */
  startDate?: string;
}

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  rawContent: string | null;
  publishedDate: string | null;
  score: number;
}

export interface ExtractResult {
  url: string;
  rawContent: string;
}

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResult[]>;
  extract(urls: string[]): Promise<ExtractResult[]>;
}

const TavilySearchResponse = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      raw_content: z.string().nullish(),
      published_date: z.string().nullish(),
      score: z.number().nullish(),
    }),
  ),
});

const TavilyExtractResponse = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string().nullish() })),
  failed_results: z.array(z.object({ url: z.string(), error: z.string().nullish() })).nullish(),
});

const BASE_URL = "https://api.tavily.com";
// Advanced search with page text can legitimately take 20s+; a short timeout only buys a paid retry.
const TIMEOUT_MS = 40_000;
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyStatus(status: number): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError("tavily", "auth", "Tavily rejected the API key. Check TAVILY_API_KEY.");
  if (status === 429)
    return new ProviderError("tavily", "rate_limit", "Tavily rate limit reached. Wait a minute and retry.");
  if (status === 432 || status === 433 || status === 434)
    return new ProviderError("tavily", "rate_limit", "Tavily plan or usage limit reached for this API key.");
  if (status >= 500) return new ProviderError("tavily", "unavailable", `Tavily is unavailable (HTTP ${status}).`);
  return new ProviderError("tavily", "bad_request", `Tavily rejected the request (HTTP ${status}).`);
}

const isRetryable = (e: ProviderError) => e.kind === "unavailable" || e.kind === "rate_limit";

/** Real Tavily client: timeout per request, retry with backoff on 429/5xx/network errors, zod-validated responses. */
export class TavilyProvider implements SearchProvider {
  private readonly apiKey: string;

  constructor(apiKey = getConfig().tavilyApiKey) {
    if (!apiKey) throw new ProviderError("tavily", "config", "TAVILY_API_KEY is not set. Add it to .env.local and restart.");
    this.apiKey = apiKey;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    let lastError: ProviderError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(`${BASE_URL}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok) return await readJsonCapped(response);
        lastError = classifyStatus(response.status);
        // Plan/quota limits (432-434) won't clear on retry.
        if (!isRetryable(lastError) || response.status >= 432) throw lastError;
      } catch (error) {
        if (error instanceof ProviderError && !isRetryable(error)) throw error;
        if (error instanceof ResponseTooLargeError) throw new ProviderError("tavily", "invalid_output", error.message);
        lastError =
          error instanceof ProviderError
            ? error
            : new ProviderError("tavily", "unavailable", `Could not reach Tavily: ${redact(error instanceof Error ? error.message : String(error))}`);
      }
      if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
    }
    throw lastError ?? new ProviderError("tavily", "unavailable", "Tavily request failed.");
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const raw = await this.post("/search", {
      query: query.query,
      topic: query.topic ?? "general",
      search_depth: "advanced",
      max_results: query.maxResults ?? 5,
      include_raw_content: "text",
      include_answer: false,
      include_published_date: true,
      ...(query.startDate ? { start_date: query.startDate } : {}),
    });
    const parsed = TavilySearchResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError("tavily", "invalid_output", "Tavily returned an unexpected response shape.");
    return parsed.data.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      content: r.content ?? "",
      rawContent: r.raw_content ?? null,
      publishedDate: r.published_date ?? null,
      score: r.score ?? 0,
    }));
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    if (urls.length === 0) return [];
    const raw = await this.post("/extract", { urls, extract_depth: "basic", format: "text" });
    const parsed = TavilyExtractResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError("tavily", "invalid_output", "Tavily returned an unexpected extract response.");
    return parsed.data.results
      .filter((r) => r.raw_content)
      .map((r) => ({ url: r.url, rawContent: r.raw_content ?? "" }));
  }
}
