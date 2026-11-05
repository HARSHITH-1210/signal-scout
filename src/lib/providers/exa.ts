import { z } from "zod";
import { getConfig, redact } from "../config";
import { ProviderError } from "../errors";
import { readJsonCapped, ResponseTooLargeError } from "./http";
import type { ExtractResult, SearchProvider, SearchQuery, SearchResult } from "./search";

const BASE_URL = "https://api.exa.ai";
const TIMEOUT_MS = 40_000;
const MAX_TEXT_CHARS = 12_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const ExaSearchResponse = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      text: z.string().nullish(),
      publishedDate: z.string().nullish(),
      score: z.number().nullish(),
    }),
  ),
});

const ExaContentsResponse = z.object({
  results: z.array(z.object({ url: z.string(), text: z.string().nullish() })),
});

function classify(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("exa", "auth", "Exa rejected the API key. Check EXA_API_KEY.");
  if (status === 402) return new ProviderError("exa", "quota", "Exa credits are used up for this month.");
  if (status === 429) return new ProviderError("exa", "rate_limit", "Exa rate limit reached. Wait a minute and retry.");
  if (status >= 500) return new ProviderError("exa", "unavailable", `Exa is unavailable (HTTP ${status}).`);
  return new ProviderError("exa", "bad_request", `Exa rejected the request (HTTP ${status}).`);
}

/** Exa search with page text, the backup for Tavily. Single attempt: the chain decides what to try next. */
export class ExaProvider implements SearchProvider {
  private readonly apiKey: string;

  constructor(
    apiKey = getConfig().exaApiKey,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    if (!apiKey) throw new ProviderError("exa", "config", "EXA_API_KEY is not set.");
    this.apiKey = apiKey;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError("exa", "unavailable", `Could not reach Exa: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
    if (!response.ok) throw classify(response.status);
    try {
      return await readJsonCapped(response);
    } catch (error) {
      throw new ProviderError("exa", "invalid_output", error instanceof ResponseTooLargeError ? error.message : "Exa returned unreadable JSON.");
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const raw = await this.post("/search", {
      query: query.query,
      type: "auto",
      numResults: query.maxResults ?? 5,
      contents: { text: { maxCharacters: MAX_TEXT_CHARS } },
      ...(query.topic === "news" ? { category: "news" } : {}),
      ...(query.startDate ? { startPublishedDate: `${query.startDate}T00:00:00.000Z` } : {}),
    });
    const parsed = ExaSearchResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError("exa", "invalid_output", "Exa returned an unexpected response shape.");
    return parsed.data.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      content: (r.text ?? "").slice(0, 300),
      rawContent: r.text ?? null,
      publishedDate: r.publishedDate ?? null,
      score: r.score ?? 0.5,
    }));
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    if (urls.length === 0) return [];
    const raw = await this.post("/contents", { urls, text: { maxCharacters: MAX_TEXT_CHARS * 2 } });
    const parsed = ExaContentsResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError("exa", "invalid_output", "Exa returned an unexpected contents response.");
    return parsed.data.results.filter((r) => r.text).map((r) => ({ url: r.url, rawContent: r.text ?? "" }));
  }
}
