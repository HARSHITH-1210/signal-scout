import type { ContactHold, DeliveryTracking, RunStatus, SentRecord, SignalType } from "../types";

/** One run, reduced to what the Outreach page needs. */
export interface OutreachRow {
  runId: string;
  label: string;
  status: RunStatus;
  createdAt: string;
  error: string | null;
  hookType: SignalType | null;
  hold: ContactHold | null;
  badNews: boolean;
  draft: { version: number; subject: string; expiresAt: string | null } | null;
  sent: (SentRecord & { subject: string | null }) | null;
}

export type ActionKind = "send_failed" | "bad_news" | "review" | "approved_unsent" | "clarify" | "relationship" | "expired";

export interface OutreachAction {
  runId: string;
  label: string;
  kind: ActionKind;
  /** The draft's use-by date, for review items. */
  dueAt: string | null;
  note: string | null;
}

export type SentState = DeliveryTracking["state"] | "untracked";

export interface SentLogEntry {
  runId: string;
  label: string;
  subject: string | null;
  to: string;
  sentAt: string;
  state: SentState;
  eventAt: string | null;
  threadId: string | null;
}

export interface OutreachStats {
  tiles: {
    needsReview: number;
    expiringSoon: number;
    sent: number;
    sentThisWeek: number;
    delivered: number;
    replied: number;
    autoReplies: number;
    bounced: number;
    pending: number;
    untracked: number;
    /** Human replies over delivered emails; null until something is delivered. */
    replyRate: number | null;
  };
  funnel: { key: string; label: string; count: number }[];
  actions: OutreachAction[];
  sentLog: SentLogEntry[];
  perDay: { date: string; count: number }[];
  byHook: { hookType: SignalType | "role_based"; sent: number; replied: number }[];
  lastCheckedAt: string | null;
}

const DAY = 86_400_000;
const EXPIRING_WITHIN_MS = 2 * DAY;
const ACTION_ORDER: ActionKind[] = ["send_failed", "bad_news", "review", "approved_unsent", "clarify", "relationship", "expired"];

const isExpired = (expiresAt: string | null, now: Date) => Boolean(expiresAt) && new Date(expiresAt!).getTime() < now.getTime();

function action(row: OutreachRow, now: Date): OutreachAction | null {
  const base = { runId: row.runId, label: row.label, dueAt: null, note: null };
  switch (row.status) {
    case "awaiting_review":
      if (isExpired(row.draft?.expiresAt ?? null, now)) return { ...base, kind: "expired", note: "Research again before sending" };
      if (row.badNews) return { ...base, kind: "bad_news", note: "Recent bad news: decide whether to reach out" };
      return { ...base, kind: "review", dueAt: row.draft?.expiresAt ?? null };
    case "approved":
      return row.error?.startsWith("Approved, but not sent")
        ? { ...base, kind: "send_failed", note: row.error.replace(/^Approved, but not sent:\s*/, "") }
        : { ...base, kind: "approved_unsent", note: "Approved, not sent yet" };
    case "needs_clarification":
      return { ...base, kind: "clarify", note: "Pick the right person or company" };
    case "held":
      return row.hold?.kind === "relationship" ? { ...base, kind: "relationship", note: row.hold.note ?? `Matches ${row.hold.match}` } : null;
    default:
      return null;
  }
}

/** Every number on the Outreach page, from stored runs. Pure: the page and tests share it. */
export function computeOutreach(rows: OutreachRow[], now: Date): OutreachStats {
  const sentRows = rows.filter((r): r is OutreachRow & { sent: NonNullable<OutreachRow["sent"]> } => r.sent !== null);
  const stateOf = (s: SentRecord): SentState => s.tracking?.state ?? "untracked";
  const count = (...states: SentState[]) => sentRows.filter((r) => states.includes(stateOf(r.sent))).length;

  const delivered = count("delivered", "replied", "auto_reply");
  const replied = count("replied");
  const reviewRows = rows.filter((r) => r.status === "awaiting_review" && !isExpired(r.draft?.expiresAt ?? null, now));

  const actions = rows
    .map((r) => action(r, now))
    .filter((a): a is OutreachAction => a !== null)
    .sort((a, b) => ACTION_ORDER.indexOf(a.kind) - ACTION_ORDER.indexOf(b.kind) || (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));

  const sentLog: SentLogEntry[] = sentRows
    .map((r) => ({
      runId: r.runId,
      label: r.label,
      subject: r.sent.subject,
      to: r.sent.to,
      sentAt: r.sent.sentAt,
      state: stateOf(r.sent),
      eventAt: r.sent.tracking?.eventAt ?? null,
      threadId: r.sent.threadId ?? null,
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  // Fourteen calendar days (UTC), oldest first, including today.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const perDay = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(today - (13 - i) * DAY).toISOString().slice(0, 10);
    return { date, count: sentRows.filter((r) => r.sent.sentAt.slice(0, 10) === date).length };
  });

  const hooks = new Map<SignalType | "role_based", { sent: number; replied: number }>();
  for (const r of sentRows) {
    const key = r.hookType ?? "role_based";
    const entry = hooks.get(key) ?? { sent: 0, replied: 0 };
    entry.sent++;
    if (stateOf(r.sent) === "replied") entry.replied++;
    hooks.set(key, entry);
  }

  const checks = sentRows.map((r) => r.sent.tracking?.checkedAt).filter((c): c is string => Boolean(c));

  return {
    tiles: {
      needsReview: reviewRows.length,
      expiringSoon: reviewRows.filter((r) => r.draft?.expiresAt && new Date(r.draft.expiresAt).getTime() - now.getTime() < EXPIRING_WITHIN_MS).length,
      sent: sentRows.length,
      sentThisWeek: sentRows.filter((r) => now.getTime() - new Date(r.sent.sentAt).getTime() < 7 * DAY).length,
      delivered,
      replied,
      autoReplies: count("auto_reply"),
      bounced: count("bounced"),
      pending: count("pending"),
      untracked: count("untracked"),
      replyRate: delivered > 0 ? replied / delivered : null,
    },
    funnel: [
      { key: "researched", label: "Researched", count: rows.length },
      { key: "drafted", label: "Draft ready", count: rows.filter((r) => r.draft !== null).length },
      { key: "approved", label: "Approved", count: rows.filter((r) => r.status === "approved" || r.status === "sent").length },
      { key: "sent", label: "Sent", count: sentRows.length },
      { key: "delivered", label: "Delivered", count: delivered },
      { key: "replied", label: "Replied", count: replied },
    ],
    actions,
    sentLog,
    perDay,
    byHook: [...hooks.entries()].map(([hookType, v]) => ({ hookType, ...v })).sort((a, b) => b.sent - a.sent),
    lastCheckedAt: checks.length ? checks.sort().at(-1)! : null,
  };
}
