import { z } from "zod";
import { redact } from "../config";
import { ProviderError } from "../errors";
import { readTextCapped } from "./http";
import type { PageReader } from "./reader";
import type { ExtractResult, SearchProvider, SearchQuery, SearchResult } from "./search";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const TIMEOUT_MS = 20_000;
// GDELT asks for at most one request every five seconds.
const MIN_SPACING_MS = 5_000;
const CACHE_MS = 10 * 60_000;
const READ_TOP = 3;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const ArtList = z.object({
  articles: z
    .array(z.object({ url: z.string(), title: z.string().nullish(), seendate: z.string().nullish(), language: z.string().nullish() }))
    .nullish(),
});

/** "20261105T120000Z" → ISO date-time. */
export function gdeltDate(seen: string | null | undefined): string | null {
  const m = seen ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seen) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** The phrase GDELT searches for: the query's subject, else its quoted phrase, else its first few words. */
export function gdeltPhrase(query: SearchQuery): string {
  const raw = query.subject ?? /"([^"]+)"/.exec(query.query)?.[1] ?? query.query.split(/\s+/).slice(0, 3).join(" ");
  return raw.replace(/["()]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * GDELT's free news index: no key, worldwide coverage, publication dates. Last resort for search when the
 * keyed providers are down. Articles come without text, so the top few are read with a page reader;
 * the rest keep only their headline (which is still verifiable text).
 */
export class GdeltProvider implements SearchProvider {
  private lastCallAt = 0;
  private readonly cache = new Map<string, { at: number; results: SearchResult[] }>();

  constructor(
    private readonly reader: PageReader | null = null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly spacingMs = MIN_SPACING_MS,
  ) {}

  private async throttle() {
    const wait = this.lastCallAt + this.spacingMs - Date.now();
    this.lastCallAt = Math.max(Date.now(), this.lastCallAt + this.spacingMs);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const phrase = gdeltPhrase(query);
    if (phrase.length < 2) return [];
    const cached = this.cache.get(phrase.toLowerCase());
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.results;

    await this.throttle();
    const params = new URLSearchParams({ query: `"${phrase}" sourcelang:english`, mode: "ArtList", format: "json", maxrecords: "10", sort: "DateDesc", timespan: "3months" });
    let text: string;
    try {
      const res = await this.fetchImpl(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 429) throw new ProviderError("gdelt", "rate_limit", "GDELT asked to slow down.");
      if (!res.ok) throw new ProviderError("gdelt", res.status >= 500 ? "unavailable" : "bad_request", `GDELT failed (HTTP ${res.status}).`);
      text = await readTextCapped(res, 2 * 1024 * 1024);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("gdelt", "unavailable", `Could not reach GDELT: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
    // GDELT answers query problems with a plain-text sentence and HTTP 200.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("gdelt", "bad_request", `GDELT couldn't run the search (${text.slice(0, 120)}).`);
    }
    const parsed = ArtList.safeParse(json);
    if (!parsed.success) throw new ProviderError("gdelt", "invalid_output", "GDELT returned an unexpected response.");
    const articles = (parsed.data.articles ?? []).filter((a) => !a.language || /english/i.test(a.language)).slice(0, query.maxResults ?? 6);

    let bodies: ExtractResult[] = [];
    if (this.reader && articles.length) bodies = await this.reader.extract(articles.slice(0, READ_TOP).map((a) => a.url)).catch(() => []);
    const bodyFor = new Map(bodies.map((b) => [b.url, b.rawContent]));
    const results: SearchResult[] = articles.map((a) => {
      const title = a.title?.trim() || a.url;
      const body = bodyFor.get(a.url) ?? null;
      return { url: a.url, title, content: (body ?? title).slice(0, 300), rawContent: body ?? title, publishedDate: gdeltDate(a.seendate), score: 0.4 };
    });
    this.cache.set(phrase.toLowerCase(), { at: Date.now(), results });
    return results;
  }

  async extract(): Promise<ExtractResult[]> {
    return [];
  }
}
