import type { Signal } from "../types";

// Bad news (layoffs, breaches, lawsuits…) is recent and prominent, so it tends to outscore real hooks.
// It is never a hook; it puts the prospect on hold for the rep to decide whether to reach out now.
const SENSITIVE: RegExp[] = [
  /\b(lay ?offs?|laid off|job cuts|cut(s|ting)? \d+ (jobs|roles|positions)|redundanc(y|ies)|workforce reduction|downsiz(e|ed|ing))\b/i,
  /\b(data breach|breach(ed)?|hack(ed|ers?)|cyber ?attack|ransomware|data leak|security incident)\b/i,
  /\b(lawsuits?|sued|sues|class[- ]action|litigation|indicted|charged with|fraud|settle(d|ment) (with|over))\b/i,
  /\b(bankrupt(cy)?|insolven(t|cy)|chapter 11|administration|receivership|liquidation)\b/i,
  /\b(investigation|probe|subpoena|fined|penalt(y|ies)|sanction(s|ed))\b/i,
  /\b(recall(ed|s)?|outage|scandal|misconduct)\b/i,
  /\b(died|passed away|death of|fatal)\b/i,
];

/** True when a finding reports bad news about the prospect or their company. */
export function isSensitive(text: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(text));
}

/** The first sensitive term in a text, for showing the reviewer what matched. */
export function sensitiveTerm(text: string): string | null {
  for (const pattern of SENSITIVE) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/** Verified, not-stale bad news: the rep must decide whether to reach out now before a draft can be approved. */
export function badNewsHold(signals: Signal[]): Signal[] {
  return signals.filter((s) => s.status === "verified" && s.sensitive && s.freshness !== "stale");
}
