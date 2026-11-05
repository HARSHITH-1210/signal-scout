import type { Freshness, SignalType } from "../types";

export const FRESH_DAYS = 180;
export const AGING_DAYS = 365;

/**
 * How long each kind of signal stays usable as a hook (days until "aging", days until "stale").
 * A job post or a crisis goes cold in weeks; a strategy or a funding round stays relevant longer.
 */
export const RECENCY_WINDOWS: Record<SignalType, { fresh: number; aging: number }> = {
  hiring: { fresh: 60, aging: 120 },
  challenge: { fresh: 90, aging: 180 },
  award: { fresh: 90, aging: 180 },
  product_launch: { fresh: 120, aging: 270 },
  partnership: { fresh: 150, aging: 300 },
  expansion: { fresh: 150, aging: 300 },
  funding: { fresh: 180, aging: 365 },
  leadership_change: { fresh: 180, aging: 365 },
  interview_or_talk: { fresh: 180, aging: 365 },
  strategic_priority: { fresh: 180, aging: 365 },
  other: { fresh: FRESH_DAYS, aging: AGING_DAYS },
};

export const FRESHNESS_WEIGHT: Record<Freshness, number> = {
  fresh: 1,
  aging: 0.7,
  unknown: 0.5,
  stale: 0.4,
};

/**
 * Parses the loose date formats we see from search results and model extraction
 * ("2025-03-14", "2025-03", "2025", RFC 2822 strings). Returns null when unparseable.
 */
export function parseLooseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ym = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ym) return new Date(Date.UTC(Number(ym[1]), Number(ym[2]) - 1, 15));
  const y = /^(\d{4})$/.exec(trimmed);
  if (y) return new Date(Date.UTC(Number(y[1]), 6, 1));
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Freshness comes from the event date when the model found one in the text, else the publish date.
 * A date in the future (beyond a day of clock skew) is treated as unknown rather than trusted.
 */
export function assessFreshness(
  eventDate: string | null,
  publishedDate: string | null,
  now: Date,
  type: SignalType = "other",
): { freshness: Freshness; ageDays: number | null } {
  const window = RECENCY_WINDOWS[type] ?? RECENCY_WINDOWS.other;
  const date = parseLooseDate(eventDate) ?? parseLooseDate(publishedDate);
  if (!date) return { freshness: "unknown", ageDays: null };
  const ageDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (ageDays < -1) return { freshness: "unknown", ageDays: null };
  const age = Math.max(0, ageDays);
  if (age <= window.fresh) return { freshness: "fresh", ageDays: age };
  if (age <= window.aging) return { freshness: "aging", ageDays: age };
  return { freshness: "stale", ageDays: age };
}
