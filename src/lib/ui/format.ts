import type { Freshness, ProspectInput, RunStatus, SignalStatus, SignalType, StageStatus } from "../types";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  needs_clarification: "Needs clarification",
  held: "On hold",
  insufficient_research: "Not enough signal",
  awaiting_review: "Ready for review",
  approved: "Approved",
  sent: "Sent",
  failed: "Failed",
  stopped: "Stopped",
};

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "info",
  needs_clarification: "warn",
  held: "warn",
  insufficient_research: "warn",
  awaiting_review: "info",
  approved: "ok",
  sent: "ok",
  failed: "bad",
  stopped: "neutral",
};

export const STAGE_STATUS_TONE: Record<StageStatus, Tone> = {
  pending: "neutral",
  running: "info",
  succeeded: "ok",
  warning: "warn",
  failed: "bad",
  skipped: "neutral",
};

export const SIGNAL_STATUS_LABEL: Record<SignalStatus, string> = {
  verified: "Verified",
  rejected: "Rejected",
  conflicting: "Conflicting",
};

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "Fresh",
  aging: "Aging",
  stale: "Stale",
  unknown: "Date unknown",
};

export function signalTypeLabel(type: SignalType): string {
  const label = type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Formats only the precision the source gave us: "2025", "Mar 2025" or "Mar 14, 2025". */
export function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  if (/^\d{4}$/.test(iso)) return iso;
  const ym = /^(\d{4})-(\d{2})$/.exec(iso);
  if (ym) return new Date(Date.UTC(Number(ym[1]), Number(ym[2]) - 1, 15)).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Date-only strings are calendar dates, not instants; render them in UTC so they don't shift a day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const ms = new Date(endIso ?? Date.now()).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function hostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The best short label for a prospect, whichever fields were given. */
export function prospectLabel(p: ProspectInput, resolvedLabel?: string | null): string {
  if (!p.name && resolvedLabel) return resolvedLabel;
  const slug = p.linkedinUrl ? /\/in\/([^/?#]+)/.exec(p.linkedinUrl)?.[1] : undefined;
  return p.name ?? p.company ?? hostname(p.companyWebsite) ?? (slug ? `linkedin.com/in/${slug}` : undefined) ?? p.role ?? p.notes?.slice(0, 60) ?? "Unnamed prospect";
}

/** Secondary line under the label: the details not already used as the label. */
export function prospectDetail(p: ProspectInput, resolvedLabel?: string | null): string {
  const label = prospectLabel(p, resolvedLabel);
  const parts = [p.role, p.company].filter((v): v is string => Boolean(v) && v !== label);
  if (parts.length === 2) return `${parts[0]} at ${parts[1]}`;
  if (parts.length === 1) return parts[0];
  const host = hostname(p.companyWebsite);
  return host && host !== label ? host : "";
}

/** A duration in milliseconds as "45s" or "2m 05s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
