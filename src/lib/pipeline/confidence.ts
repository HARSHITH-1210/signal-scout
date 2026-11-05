import type { Degradation, DraftConfidence, DraftKind, GuardIssue, Identity, Signal, SignalType } from "../types";

/** How long a draft stays sendable after it's written, by what its hook is about. Role-based drafts age slowest. */
const EXPIRY_DAYS: Partial<Record<SignalType, number>> = {
  hiring: 14,
  challenge: 14,
  award: 21,
  product_launch: 30,
  funding: 30,
  leadership_change: 30,
};
const DEFAULT_EXPIRY_DAYS = 21;
const ROLE_BASED_EXPIRY_DAYS = 45;

/** When a draft should be re-checked instead of sent: a role may be filled or the news may have turned. */
export function draftExpiresAt(createdAt: Date, kind: DraftKind, hookType: SignalType | null): string {
  const days = kind === "role_based" || !hookType ? ROLE_BASED_EXPIRY_DAYS : (EXPIRY_DAYS[hookType] ?? DEFAULT_EXPIRY_DAYS);
  return new Date(createdAt.getTime() + days * 86_400_000).toISOString();
}

export function isExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() < now.getTime();
}

/** A plain confidence label for the reviewer: what the draft rests on, and what weakens it. */
export function draftConfidence(kind: DraftKind, hook: Signal | undefined, identity: Identity | null, issues: GuardIssue[], degraded: Degradation[] = []): DraftConfidence {
  if (kind === "role_based" || !hook)
    return { level: "low", basis: "role", reasons: ["No verified finding was strong enough, so it speaks to their role in general and claims nothing about them."] };

  const reasons: string[] = [];
  let level: DraftConfidence["level"] = "high";
  const lower = (to: DraftConfidence["level"], reason: string) => {
    reasons.push(reason);
    if (to === "low" || (to === "medium" && level === "high")) level = to;
  };

  const basis: DraftConfidence["basis"] = hook.about === "person" && identity?.personConfirmed ? "person" : "company";
  if (!identity?.resolvedName) lower("medium", "No specific person: written to the company.");
  else if (!identity.personConfirmed) lower("medium", "The person wasn't confirmed at this company in public sources.");
  else if (hook.about === "company") lower("medium", "The hook is company news, not something the person did or said.");

  if (hook.freshness === "stale") lower("low", "The hook is stale for its kind of signal.");
  else if (hook.freshness === "unknown") lower("medium", "The hook is undated.");
  else if (hook.freshness === "aging") lower("medium", "The hook is aging.");

  if ((hook.score ?? 0) < 0.5) lower("medium", "The hook is only moderately relevant to the offer.");
  if (issues.some((i) => i.code === "generic_personalisation")) lower("low", "The draft fails the swap test: it could go to anyone.");
  if (issues.some((i) => i.severity === "error")) lower("low", "Checks found issues that must be fixed.");
  if (degraded.some((d) => d.code === "model_review_skipped")) lower("medium", "The AI context and conflict review didn't run; findings are quote-verified only.");
  if (degraded.some((d) => d.code === "documents_only" || d.code === "research_failed")) lower("medium", "Web research was partly unavailable, so fewer sources were checked.");

  return { level, basis, reasons };
}
