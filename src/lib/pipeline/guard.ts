import type { ClaimCheck, GuardIssue, GuardReport, Signal, Source } from "../types";
import { sensitiveTerm } from "./sensitive";

// A structured first touch (hook, insight, value, ask) needs room to be specific; past ~200 words it stops being read.
export const TARGET_MIN_WORDS = 90;
export const TARGET_MAX_WORDS = 200;
export const HARD_MAX_WORDS = 260;

const FLATTERY_AND_TEMPLATE_PHRASES: RegExp[] = [
  /\bi hope this (email|message|note) finds you well\b/i,
  /\bi came across your (profile|company)\b/i,
  /\bi was (really |so )?(impressed|blown away|amazed)\b/i,
  /\b(huge|big) fan of\b/i,
  /\byour (incredible|amazing|impressive|stellar|inspiring) (work|journey|leadership|career)\b/i,
  /\bthought leader\b/i,
  /\bgame[- ]chang(er|ing)\b/i,
  /\bcutting[- ]edge\b/i,
  /\bsynerg(y|ies)\b/i,
  /\bjust (wanted to )?(reach out|touch base|check in)\b/i,
  /\bquick question\b/i,
  /\brevolutioni[sz](e|ing)\b/i,
  /\bworld[- ]class\b/i,
  /\bi('d| would) love to pick your brain\b/i,
];

const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}|<[A-Z][A-Z _]{2,}>|\bXX+\b|\bTBD\b/;

const RECENCY_WORDING = /\b(recent(ly)?|just (announced|raised|launched|hired|closed)|this (week|month|quarter)|newly)\b/i;

// Congratulating a funding round or award is what every other seller sends that week.
const CONGRATULATIONS = /\bcongrat(s|ulations|ulate)?\b/i;

// The prospect's problems or feelings stated as observed fact ("I can see you're struggling with…").
const ASSUMPTION_AS_FACT: RegExp[] = [
  /\b(i can see|i see|i noticed|i know|it'?s clear|clearly|obviously)\b[^.?!\n]{0,30}\b(you('re| are)|your team('s| is| are)?)\b[^.?!\n]{0,15}\b(struggl|having trouble|frustrat|stuck|behind|overwhelm|stretched|pain)/i,
  /\byou('re| are) (clearly |obviously |probably )?(struggling|having trouble|frustrated|stuck|behind|overwhelmed|drowning)\b/i,
  /\byou must be\b/i,
  /\byour team (is|are) (struggling|overwhelmed|drowning|stretched thin|frustrated)\b/i,
];

const STOPWORDS = new Set(
  "about after again also among announced around based because been before being between both company could during each every from have having into its just more most much other over said says some such than that their them then there these they this those through under until very were what when where which while will with within would year years your team teams business customers today million billion percent".split(" "),
);

/** Words and numbers specific to a finding: what a draft built on it should mention. */
export function distinctiveTerms(text: string, exclude: string[]): Set<string> {
  const excluded = new Set(exclude.flatMap((e) => e.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(Boolean));
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (/^\d{2,}$/.test(w) || (w.length >= 5 && !/^\d+$/.test(w))) && !STOPWORDS.has(w) && !excluded.has(w));
  return new Set(terms);
}

/**
 * Swap test: if the body shares fewer than two distinctive words with its hook's quote and claim, it
 * would read the same with another prospect's name and company in it. Exported for tests.
 */
export function failsSwapTest(body: string, hook: Signal, names: string[]): boolean {
  const wanted = distinctiveTerms(`${hook.claim} ${hook.evidenceQuote}`, names);
  if (wanted.size < 2) return false; // too little to compare against; don't guess
  const present = distinctiveTerms(body, names);
  let shared = 0;
  for (const term of wanted) if (present.has(term)) shared++;
  return shared < 2;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]]+/gi;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export interface GuardContext {
  signals: Signal[];
  sources: Source[];
  staleHook: boolean;
  senderWebsite: string;
  /** False when no person was given or confirmed: the greeting must not name anyone. */
  recipientNamed?: boolean;
  /** The hook a personalised draft is built on, for the swap test. */
  hookSignalId?: string | null;
  /** Prospect person and company names, ignored by the swap test (swapping them is the test). */
  prospectNames?: string[];
}

const GREETING_NAME = /^\s*(?:hi|hello|hey|dear)\s+([A-Z][\p{L}'-]+)/imu;
const GENERIC_GREETING_WORDS = new Set(["there", "team", "all", "everyone", "folks", "again", "friends", "colleagues", "both", "you"]);

/** Deterministic quality checks on a draft. Issues are surfaced to the reviewer, never hidden. */
export function runDeterministicGuard(
  draft: { subject: string; body: string; signalIdsUsed: string[] },
  ctx: GuardContext,
): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const text = `${draft.subject}\n${draft.body}`;
  const words = countWords(draft.body);

  if (words > HARD_MAX_WORDS)
    issues.push({ severity: "error", code: "too_long", message: `Body is ${words} words; keep first-touch emails under ${TARGET_MAX_WORDS}.` });
  else if (words > TARGET_MAX_WORDS)
    issues.push({ severity: "warning", code: "long", message: `Body is ${words} words; aim for ${TARGET_MAX_WORDS} or fewer.` });
  if (words < TARGET_MIN_WORDS) issues.push({ severity: "warning", code: "too_short", message: `Body is ${words} words; it may be too thin to make a specific case.` });
  if (!draft.subject.trim()) issues.push({ severity: "error", code: "no_subject", message: "Subject line is empty." });

  const placeholder = PLACEHOLDER.exec(text);
  if (placeholder)
    issues.push({ severity: "error", code: "placeholder", message: "Draft contains an unfilled placeholder.", excerpt: placeholder[0] });

  for (const pattern of FLATTERY_AND_TEMPLATE_PHRASES) {
    const match = pattern.exec(text);
    if (match)
      issues.push({ severity: "warning", code: "generic_phrase", message: "Generic or flattering phrase; replace with something specific.", excerpt: match[0] });
  }

  if (ctx.recipientNamed === false) {
    const greeting = GREETING_NAME.exec(draft.body);
    if (greeting && !GENERIC_GREETING_WORDS.has(greeting[1].toLowerCase()))
      issues.push({ severity: "error", code: "invented_name", message: "No person was named for this prospect, but the greeting addresses someone by name.", excerpt: greeting[0].trim() });
  }

  if (ctx.staleHook) {
    const match = RECENCY_WORDING.exec(text);
    if (match)
      issues.push({ severity: "error", code: "stale_as_recent", message: "The hook is stale for its kind of signal, but the draft describes it as recent.", excerpt: match[0] });
  }

  const congrats = CONGRATULATIONS.exec(draft.body);
  if (congrats)
    issues.push({ severity: "warning", code: "overused_opener", message: "Congratulations is what every other seller sends about this news. Lead with what it changes for their role.", excerpt: congrats[0] });

  for (const pattern of ASSUMPTION_AS_FACT) {
    const match = pattern.exec(draft.body);
    if (match) {
      issues.push({ severity: "warning", code: "assumption_as_fact", message: "States a guess about their problems as fact. Say what you observed, then ask about it.", excerpt: match[0] });
      break;
    }
  }

  const bad = sensitiveTerm(draft.body);
  if (bad) issues.push({ severity: "warning", code: "mentions_bad_news", message: "The draft mentions what reads like bad news. Leave it out of a first touch.", excerpt: bad });

  const hookSignal = ctx.hookSignalId ? ctx.signals.find((s) => s.id === ctx.hookSignalId) : undefined;
  if (hookSignal && failsSwapTest(draft.body, hookSignal, ctx.prospectNames ?? []))
    issues.push({ severity: "warning", code: "generic_personalisation", message: "This would read the same sent to another company: it mentions nothing specific from the hook. Regenerate or add a concrete detail." });

  const verifiedIds = new Set(ctx.signals.filter((s) => s.status === "verified").map((s) => s.id));
  for (const id of draft.signalIdsUsed) {
    if (!verifiedIds.has(id))
      issues.push({ severity: "error", code: "unverified_signal", message: `Draft relies on signal ${id}, which is not verified.` });
  }

  // First-touch drafts should carry no links; the only acceptable one is the sender's own site.
  // Researched domains are deliberately not allowed: a hostile page could plant its own URL.
  const senderHost = ctx.senderWebsite
    ? hostOf(ctx.senderWebsite.startsWith("http") ? ctx.senderWebsite : `https://${ctx.senderWebsite}`)
    : null;
  for (const url of text.match(URL_PATTERN) ?? []) {
    const host = hostOf(url);
    if (!host || host !== senderHost)
      issues.push({ severity: "error", code: "unknown_link", message: "Draft contains a link that is not the sender's own website. Remove it.", excerpt: url });
  }
  return issues;
}

/**
 * Turns claim-audit output into guard issues. A prospect fact needs a verified finding (or the rep's own
 * notes) behind it: otherwise it's an error. A claim about the seller needs the sender profile or the
 * seller's documents behind it: otherwise it's a warning, since only the rep knows if it's true.
 */
export function claimIssues(claims: ClaimCheck[], signals: Signal[]): GuardIssue[] {
  const verifiedIds = new Set(signals.filter((s) => s.status === "verified").map((s) => s.id));
  const issues: GuardIssue[] = [];
  for (const c of claims) {
    if (c.kind === "prospect_fact" && !(c.supportedBy && (verifiedIds.has(c.supportedBy) || c.supportedBy === "rep_notes")))
      issues.push({
        severity: "error",
        code: "unsupported_claim",
        message: "This statement about the prospect is not backed by verified evidence. Remove or verify it.",
        excerpt: c.text,
      });
    if (c.kind === "sender_claim" && !(c.supportedBy === "sender_profile" || c.supportedBy === "seller_documents"))
      issues.push({
        severity: "warning",
        code: "unsupported_sender_claim",
        message: "This claim about your offering isn't in your sender profile or documents. Make sure it's true.",
        excerpt: c.text,
      });
  }
  return issues;
}

export function buildGuardReport(
  body: string,
  issues: GuardIssue[],
  claims: ClaimCheck[] | null,
  claimCheckNote: string | null,
): GuardReport {
  return { wordCount: countWords(body), issues, claims, claimCheckNote };
}
