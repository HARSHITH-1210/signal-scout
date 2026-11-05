import type { Source } from "../types";
import { normaliseForMatch } from "./sanitize";

const MIN_QUOTE_CHARS = 12;
/** Elided quotes ("A ... B") may only bridge a short gap, so fragments can't be stitched from across a page. */
export const MAX_ELISION_GAP = 250;
const MAX_FRAGMENTS = 3;

export type EvidenceCheck = { ok: true } | { ok: false; reason: string };

/**
 * Deterministic anti-fabrication check: the quote must appear verbatim (after whitespace/case/quote
 * normalisation) in the exact source text the model was shown. Elided quotes must have every
 * fragment present, in order, each within MAX_ELISION_GAP characters of the previous one.
 */
export function verifyEvidenceQuote(quote: string, source: Source | undefined): EvidenceCheck {
  if (!source) return { ok: false, reason: "Cited source does not exist in this run's research." };
  const normalisedQuote = normaliseForMatch(quote).replace(/^["']|["']$/g, "");
  if (normalisedQuote.length < MIN_QUOTE_CHARS) return { ok: false, reason: "Evidence quote is too short to verify." };

  const haystack = normaliseForMatch(`${source.title}\n${source.text}`);
  const fragments = normalisedQuote
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (fragments.length > MAX_FRAGMENTS) return { ok: false, reason: "Evidence quote stitches together too many fragments to verify." };

  // Try every occurrence of the first fragment, so an early unrelated match doesn't hide a valid one.
  let start = haystack.indexOf(fragments[0]);
  while (start !== -1) {
    let cursor = start + fragments[0].length;
    let ok = true;
    for (const fragment of fragments.slice(1)) {
      const at = haystack.indexOf(fragment, cursor);
      if (at === -1 || at - cursor > MAX_ELISION_GAP) {
        ok = false;
        break;
      }
      cursor = at + fragment.length;
    }
    if (ok) return { ok: true };
    start = haystack.indexOf(fragments[0], start + 1);
  }
  return fragments.length > 1 && haystack.includes(fragments[0])
    ? { ok: false, reason: "Evidence quote joins sentences that are too far apart in the source." }
    : { ok: false, reason: "Evidence quote was not found in the cited source text." };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a pattern matching the phrase as whole words, with flexible whitespace between them. */
function wordPattern(phrase: string, flags = "iu"): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map(escapeRegex)
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags);
}

/** True when the phrase appears as whole words (not inside other words). */
export function containsWords(text: string, phrase: string): boolean {
  return phrase.trim().length > 0 && wordPattern(normaliseForMatch(phrase)).test(normaliseForMatch(text));
}

// Only legal-form suffixes are stripped. Descriptive words ("AI", "Labs", "Group") are part of the
// name: stripping them turned "Scale AI" into "scale" and "The Company Group" into "the".
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "gmbh", "plc", "pvt", "private", "sa", "ag", "bv", "pty"]);

/** Company name for mention checks: "Acme Robotics, Inc." -> "acme robotics"; "The Home Depot" -> "home depot". */
export function coreCompanyName(company: string): string {
  let tokens = normaliseForMatch(company)
    .replace(/[,.()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);
  return tokens.join(" ");
}

/**
 * True if the text names the company: as whole words, by full domain, or by a distinctive domain stem.
 * Single-word names must appear capitalised, so "Ramp" isn't matched by "ramping up" or "a ramp".
 */
export function mentionsCompany(text: string, company: string | null, domain: string | null): boolean {
  const core = company ? coreCompanyName(company) : "";
  if (core.length >= 2) {
    if (core.includes(" ")) {
      if (containsWords(text, core)) return true;
    } else {
      const capitalised = core.charAt(0).toUpperCase() + core.slice(1);
      const original = company!.trim().split(/\s+/)[0].replace(/[,.]$/, "");
      if (wordPattern(capitalised, "u").test(text) || wordPattern(original, "u").test(text) || wordPattern(core.toUpperCase(), "u").test(text)) return true;
    }
  }
  if (domain) {
    const bare = domain.toLowerCase().replace(/^www\./, "");
    if (containsWords(text, bare)) return true;
    const stem = bare.split(".")[0];
    if (stem && stem.length >= 6 && containsWords(text, stem)) return true;
  }
  return false;
}

/**
 * True if the text names the person: first and last name as whole words, allowing up to two middle
 * names or initials between them ("Priya K. Raman"). A shared surname alone is not enough.
 */
export function mentionsPerson(text: string, name: string): boolean {
  const parts = normaliseForMatch(name)
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 2);
  if (parts.length === 0) return false;
  const haystack = normaliseForMatch(text);
  if (parts.length === 1) return wordPattern(parts[0]).test(haystack);
  const first = escapeRegex(parts[0]);
  const last = escapeRegex(parts[parts.length - 1]);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${first}\\s+(?:[\\p{L}.'-]+\\s+){0,2}${last}(?![\\p{L}\\p{N}])`, "iu");
  return pattern.test(haystack);
}
