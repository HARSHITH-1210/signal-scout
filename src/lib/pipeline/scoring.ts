import type { Hook, Signal, SignalType } from "../types";
import { FRESHNESS_WEIGHT } from "./freshness";

/** "1 finding was" / "3 findings were". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const HOOK_THRESHOLD = 0.35;
const CORROBORATION_BONUS = 0.15;

/**
 * Headline news (a funding round, an award) triggers a wave of near-identical emails from other sellers.
 * A less obvious finding of similar quality should win; if the headline still wins, the draft skips the congratulations.
 */
export const OBVIOUS_TYPES: SignalType[] = ["funding", "award"];
const OBVIOUSNESS_PENALTY = 0.85;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** score = relevance × freshness weight × source reliability × (1 + bonus per extra corroborating domain, max 2) × obviousness. */
export function scoreSignal(signal: Pick<Signal, "relevance" | "freshness" | "reliability" | "corroboratingSourceIds"> & Partial<Pick<Signal, "type">>): number {
  const corroboration = 1 + CORROBORATION_BONUS * Math.min(signal.corroboratingSourceIds.length, 2);
  const obviousness = signal.type && OBVIOUS_TYPES.includes(signal.type) ? OBVIOUSNESS_PENALTY : 1;
  const raw = clamp01(signal.relevance) * FRESHNESS_WEIGHT[signal.freshness] * clamp01(signal.reliability) * corroboration * obviousness;
  return Math.round(raw * 1000) / 1000;
}

export interface HookSelection {
  hook: Hook | null;
  scored: Signal[];
  reasons: string[]; // why no hook was selected (empty when a hook exists)
}

/** Scores eligible signals and picks the best one above threshold. Only verified, non-conflicting, non-sensitive signals can be hooks. */
export function selectHook(signals: Signal[]): HookSelection {
  const scored = signals.map((s) => ({ ...s, score: s.status === "verified" ? scoreSignal(s) : null }));
  const eligible = scored
    .filter((s): s is Signal & { score: number } => s.status === "verified" && s.score !== null && !s.sensitive)
    .sort((a, b) => b.score - a.score);

  const best = eligible[0];
  if (best && best.score >= HOOK_THRESHOLD) {
    return {
      scored,
      reasons: [],
      hook: {
        signalId: best.id,
        score: best.score,
        whyItMatters: best.whyItMatters,
        staleCaveat: best.freshness === "stale",
        alternativeSignalIds: eligible
          .slice(1)
          .filter((s) => s.score >= HOOK_THRESHOLD * 0.75)
          .slice(0, 3)
          .map((s) => s.id),
      },
    };
  }

  const reasons: string[] = [];
  const count = (status: Signal["status"]) => signals.filter((s) => s.status === status).length;
  if (signals.length === 0) reasons.push("No usable findings came out of the public sources that were searched.");
  // Conflicts and staleness are reported by the runner for every run, so they aren't repeated here.
  const sensitive = signals.filter((s) => s.status === "verified" && s.sensitive).length;
  if (sensitive > 0) reasons.push(`${plural(sensitive, "finding reports", "findings report")} bad news, which is never used as a hook.`);
  if (count("rejected") > 0)
    reasons.push(`${plural(count("rejected"), "finding was", "findings were")} rejected because the evidence couldn't be verified.`);
  if (best)
    reasons.push(
      `The strongest verified finding scored ${best.score.toFixed(2)}, below the ${HOOK_THRESHOLD} threshold for a personalised hook.`,
    );
  if (reasons.length === 0) reasons.push("No verified, uncontested finding was available to build a hook on.");
  return { hook: null, scored, reasons };
}
