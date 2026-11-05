import type { SearchResult } from "../providers/search";
import type { Signal, Source } from "../types";
import { mentionsCompany } from "./evidence";
import { distinctiveTerms } from "./guard";
import { domainOf } from "./sourceReliability";

const MIN_SHARED = 3;
const MIN_SHARE = 0.6;

/**
 * Looks for an independent page that states the hook's fact: a different domain from every source
 * already backing it, naming the company, with one sentence sharing most of the hook quote's specific
 * words. Deterministic: a model never decides what counts as corroboration. Exported for tests.
 */
export function findCorroboration(hook: Signal, results: SearchResult[], backing: Source[], company: string | null, companyDomain: string | null, names: string[]): SearchResult[] {
  const wanted = distinctiveTerms(`${hook.evidenceQuote} ${hook.claim}`, names);
  if (wanted.size < MIN_SHARED) return [];
  const known = new Set(backing.map((s) => s.domain));
  const out: SearchResult[] = [];
  for (const result of results) {
    const domain = domainOf(result.url);
    if (!domain || known.has(domain)) continue;
    const text = result.rawContent ?? result.content;
    if (!mentionsCompany(`${result.title}\n${text}`, company, companyDomain)) continue;
    const agrees = text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
      const terms = distinctiveTerms(sentence, names);
      let shared = 0;
      for (const t of wanted) if (terms.has(t)) shared++;
      return shared >= MIN_SHARED && shared / wanted.size >= MIN_SHARE;
    });
    if (agrees) {
      out.push(result);
      known.add(domain);
    }
  }
  return out;
}
