import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getConfig, redact } from "../config";
import { ProviderError } from "../errors";
import { readTextCapped, ResponseTooLargeError } from "./http";
import type { ExtractResult } from "./search";

const TIMEOUT_MS = 20_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_TEXT_CHARS = 30_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Reads pages as text. Used when Tavily's and Exa's page extraction are unavailable. */
export interface PageReader {
  extract(urls: string[]): Promise<ExtractResult[]>;
}

/** Jina Reader (r.jina.ai): keyless with a low rate limit, higher with JINA_API_KEY. */
export class JinaReader implements PageReader {
  constructor(
    private readonly apiKey = getConfig().jinaApiKey,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async extract(urls: string[]): Promise<ExtractResult[]> {
    const out: ExtractResult[] = [];
    let lastError: ProviderError | null = null;
    for (const url of urls.slice(0, 5)) {
      try {
        const res = await this.fetchImpl(`https://r.jina.ai/${url}`, {
          headers: { Accept: "text/plain", "X-Return-Format": "text", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 429) throw new ProviderError("jina", "rate_limit", "Jina Reader rate limit reached.");
        if (res.status === 402) throw new ProviderError("jina", "quota", "Jina Reader's free allowance is used up.");
        if (res.status === 401 || res.status === 403) throw new ProviderError("jina", "auth", "Jina Reader rejected the key. Check JINA_API_KEY.");
        if (!res.ok) throw new ProviderError("jina", res.status >= 500 ? "unavailable" : "bad_request", `Jina Reader couldn't read the page (HTTP ${res.status}).`);
        const text = (await readTextCapped(res, MAX_PAGE_BYTES)).slice(0, MAX_TEXT_CHARS);
        if (text.trim()) out.push({ url, rawContent: text });
      } catch (error) {
        lastError =
          error instanceof ProviderError
            ? error
            : new ProviderError("jina", "unavailable", `Could not reach Jina Reader: ${redact(error instanceof Error ? error.message : String(error))}`);
        if (lastError.kind === "quota" || lastError.kind === "auth" || lastError.kind === "rate_limit") throw lastError;
      }
    }
    if (out.length === 0 && lastError) throw lastError;
    return out;
  }
}

/**
 * True for addresses a server-side fetch must never reach: loopback, private ranges, link-local
 * (including cloud metadata at 169.254.169.254), CGNAT, multicast and unspecified. Exported for tests.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

type Resolver = (host: string) => Promise<string[]>;
const resolveAll: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Rejects anything but a public http(s) URL whose host resolves only to public addresses. */
export async function assertPublicUrl(raw: string, resolve: Resolver = resolveAll): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("direct", "bad_request", "Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProviderError("direct", "bad_request", "Only http and https pages can be read.");
  if (url.username || url.password) throw new ProviderError("direct", "bad_request", "URLs with credentials aren't read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (addresses.length === 0) throw new ProviderError("direct", "unavailable", `Couldn't resolve ${host}.`);
  if (addresses.some(isPrivateAddress)) throw new ProviderError("direct", "bad_request", "That address points to a private network and won't be read.");
  return url;
}

/** Strips a page down to readable text: drops scripts, styles and tags, decodes common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Reads a page ourselves: the last resort when no extraction service is reachable. Guarded against
 * server-side request forgery: public http(s) only, every redirect re-checked, size and time capped.
 */
export class DirectReader implements PageReader {
  constructor(
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly resolve: Resolver = resolveAll,
  ) {}

  private async readOne(start: string): Promise<string> {
    let url = await assertPublicUrl(start, this.resolve);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          redirect: "manual",
          headers: { "User-Agent": "SignalScout/1.0 (+research for a sales email)", Accept: "text/html,text/plain" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderError("direct", "unavailable", `Couldn't load ${url.hostname}: ${redact(error instanceof Error ? error.message : String(error))}`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString(), this.resolve);
        continue;
      }
      if (!res.ok) throw new ProviderError("direct", res.status >= 500 ? "unavailable" : "bad_request", `${url.hostname} returned HTTP ${res.status}.`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new ProviderError("direct", "bad_request", `${url.hostname} didn't return a web page.`);
      try {
        const body = await readTextCapped(res, MAX_PAGE_BYTES);
        return (/html/i.test(type) ? htmlToText(body) : body).slice(0, MAX_TEXT_CHARS);
      } catch (error) {
        throw new ProviderError("direct", "invalid_output", error instanceof ResponseTooLargeError ? "The page is too large to read." : "The page couldn't be read.");
      }
    }
    throw new ProviderError("direct", "bad_request", "Too many redirects.");
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    const out: ExtractResult[] = [];
    let lastError: ProviderError | null = null;
    for (const url of urls.slice(0, 5)) {
      try {
        const text = await this.readOne(url);
        if (text.trim()) out.push({ url, rawContent: text });
      } catch (error) {
        lastError = error instanceof ProviderError ? error : new ProviderError("direct", "unavailable", "The page couldn't be read.");
      }
    }
    if (out.length === 0 && lastError) throw lastError;
    return out;
  }
}
