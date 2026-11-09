import { z } from "zod";
import type { SearchResult } from "../providers/search";
import type { PipelineDeps } from "../pipeline/context";
import { checkContactRules } from "../pipeline/contacts";
import { looksLikePromptInjection, normaliseForMatch, sanitizeText, UNTRUSTED_DATA_RULE, wrapUntrusted } from "../pipeline/sanitize";
import { isPublicHostname } from "../pipeline/validate";
import type { ContactHold, ContactRules } from "../types";

export const DiscoverQuery = z.object({ query: z.string().trim().min(3, "Enter at least 3 characters.").max(200, "Keep it under 200 characters.") });

/** Login-walled or people-profile sites are never used as sources (no scraping of LinkedIn and the like). */
const BLOCKED_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com"];
const PER_QUERY = 8;
const MAX_COMPANIES = 12;
const SOURCE_CHARS = 1500;

export interface DiscoverSource {
  url: string;
  title: string;
  domain: string;
}

export interface DiscoveredCompany {
  name: string;
  website: string | null;
  reason: string;
  sources: DiscoverSource[];
  contact: ContactHold | null;
}

export interface DiscoverResult {
  companies: DiscoveredCompany[];
  /** Search results read (after filtering). */
  searched: number;
  /** Companies the model proposed that failed the source check. */
  dropped: number;
}

const Extraction = z.object({
  companies: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        website: z.string().max(200).nullable(),
        reason: z.string().max(200),
        sourceIds: z.array(z.string()).min(1).max(5),
      }),
    )
    .max(MAX_COMPANIES),
});

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const blocked = (host: string) => BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));

/** Bare hostname from a website the model gave ("https://www.acme.com/about" → "acme.com"), or null. */
function normaliseWebsite(raw: string | null): string | null {
  if (!raw) return null;
  const host = hostOf(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return host && host.includes(".") && isPublicHostname(host) ? host : null;
}

const SYSTEM = [
  "You find companies for a B2B sales rep. From the web sources provided, list companies that match the rep's search.",
  "Only list a company if its name appears in a source you cite. Use the name exactly as written there. Never add companies from memory.",
  "For website, give the company's own domain only if it appears in a cited source; otherwise null.",
  "reason: one short factual line (under 140 characters) on why it matches, based only on the cited sources.",
  "Skip publishers, directories, investors and job boards unless they are themselves a match.",
  UNTRUSTED_DATA_RULE,
].join("\n");

/**
 * Searches the web for the rep's query and returns companies named in the results. The model only
 * proposes names; each one is kept only when its name appears verbatim in a source it cites, so no
 * company is invented. Every source link comes from the search response.
 */
export async function discoverCompanies(query: string, deps: Pick<PipelineDeps, "search" | "llm">, rules: ContactRules): Promise<DiscoverResult> {
  const settled = await Promise.allSettled([
    deps.search.search({ query, topic: "general", maxResults: PER_QUERY }),
    deps.search.search({ query: `${query} company news`, topic: "news", maxResults: PER_QUERY }),
  ]);
  const ok = settled.filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === "fulfilled");
  // Both searches failing is an error to report, not an empty result.
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;

  const seen = new Set<string>();
  const sources: (SearchResult & { id: string; host: string; text: string })[] = [];
  for (const r of ok.flatMap((s) => s.value)) {
    const host = hostOf(r.url);
    if (!host || blocked(host) || seen.has(r.url)) continue;
    seen.add(r.url);
    const text = sanitizeText(`${r.title}\n${r.content}`, SOURCE_CHARS);
    if (looksLikePromptInjection(text)) continue;
    sources.push({ ...r, id: `S${sources.length + 1}`, host, text });
  }
  if (sources.length === 0) return { companies: [], searched: 0, dropped: 0 };

  const extraction = await deps.llm.generate({
    task: "discover_companies",
    system: SYSTEM,
    user: `Search: ${query}\n\n${sources.map((s) => wrapUntrusted({ id: s.id, url: s.url, title: s.title, publishedDate: s.publishedDate, text: s.text })).join("\n\n")}`,
    schema: Extraction,
    effort: "low",
    maxTokens: 2000,
  });

  const byId = new Map(sources.map((s) => [s.id, s]));
  const names = new Set<string>();
  const companies: DiscoveredCompany[] = [];
  let dropped = 0;
  for (const c of extraction.companies) {
    const name = c.name.trim();
    const key = normaliseForMatch(name);
    if (!key || names.has(key)) continue;
    // Deterministic check: the name must appear in the text of a source it cites.
    const cited = c.sourceIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const supporting = cited.filter((s) => normaliseForMatch(s.text).includes(key));
    if (supporting.length === 0) {
      dropped++;
      continue;
    }
    names.add(key);
    // The website is kept only if that domain appears in a cited source's URL or text.
    const site = normaliseWebsite(c.website);
    const website = site && supporting.some((s) => s.host === site || s.host.endsWith(`.${site}`) || s.text.toLowerCase().includes(site)) ? site : null;
    companies.push({
      name,
      website,
      reason: c.reason.trim().slice(0, 140),
      sources: supporting.map((s) => ({ url: s.url, title: s.title, domain: s.host })),
      contact: checkContactRules({ company: name, website, domain: website }, rules),
    });
  }
  return { companies, searched: sources.length, dropped };
}
