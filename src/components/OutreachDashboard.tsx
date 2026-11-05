"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActionKind, OutreachStats, SentState } from "@/lib/outreach/stats";
import type { GmailStatus } from "@/lib/types";
import { formatDate, formatDateTime, signalTypeLabel, type Tone } from "@/lib/ui/format";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { SystemStatus } from "./SystemStatus";
import type { ProviderStatus } from "@/lib/providers/status";

type CheckResult = { checked: number; skipped: "throttled" | "not_connected" | "no_permission" | null; error: string | null };

const STATE: Record<SentState, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  delivered: { label: "Delivered", tone: "info" },
  replied: { label: "Replied", tone: "ok" },
  auto_reply: { label: "Auto-reply", tone: "neutral" },
  bounced: { label: "Bounced", tone: "bad" },
  untracked: { label: "Not tracked", tone: "neutral" },
};

const ACTION: Record<ActionKind, { label: string; tone: Tone }> = {
  send_failed: { label: "Send failed", tone: "bad" },
  bad_news: { label: "On hold", tone: "warn" },
  review: { label: "Ready for review", tone: "info" },
  approved_unsent: { label: "Approved", tone: "info" },
  clarify: { label: "Needs clarification", tone: "warn" },
  relationship: { label: "Existing relationship", tone: "warn" },
  expired: { label: "Expired", tone: "warn" },
};

const panel = "rounded-[var(--radius-panel)] border border-rule bg-paper";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-ochre" : tone === "bad" ? "text-specimen" : "text-ink";
  return (
    <div className={`${panel} p-4`}>
      <p className="text-[13px] font-bold text-muted">{label}</p>
      <p className={`mt-1 font-mono text-[28px] leading-tight tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-[13px] text-ink-soft">{sub}</p>
    </div>
  );
}

function since(iso: string | null, now: number): string {
  if (!iso) return "never";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return formatDateTime(iso);
}

/** Outreach after approval: what's waiting on the rep, what was sent, and what came back. */
export function OutreachDashboard({ initial, gmail, providers }: { initial: OutreachStats; gmail: GmailStatus; providers: ProviderStatus[] }) {
  const [stats, setStats] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  function apply(res: Awaited<ReturnType<typeof send>>, force: boolean) {
    setNow(Date.now());
    if (!res.ok) return setNotice({ tone: "bad", text: res.error });
    const { result, stats: next } = res.data as { result: CheckResult; stats: OutreachStats };
    setStats(next);
    if (result.error) setNotice({ tone: "bad", text: result.error });
    else if (force) setNotice({ tone: "ok", text: result.checked ? `Checked ${result.checked} sent ${result.checked === 1 ? "email" : "emails"}.` : "Nothing new to check." });
  }

  async function check() {
    setBusy(true);
    setNotice(null);
    const res = await send("/api/outreach/check", "POST", { force: true });
    setBusy(false);
    apply(res, true);
  }

  // Check on arrival; the server skips threads checked in the last few minutes.
  useEffect(() => {
    if (!gmail.canTrack || initial.tiles.sent === 0) return;
    let live = true;
    void send("/api/outreach/check", "POST", { force: false }).then((res) => {
      if (live) apply(res, false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

  const t = stats.tiles;
  const top = Math.max(1, stats.funnel[0]?.count ?? 1);
  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));
  const trackingNote = !gmail.connected
    ? "Gmail isn't connected, so replies and bounces aren't tracked."
    : !gmail.canTrack
      ? "Reconnect Gmail to allow reply and bounce tracking (header-only access)."
      : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em]">Outreach</h1>
          <p className="mt-1 max-w-[68ch] text-ink-soft">What happened after approval: what&apos;s waiting on you, what was sent, and what came back.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {gmail.canTrack && <span className="acc text-muted">checked {since(stats.lastCheckedAt, now)}</span>}
          <button
            type="button"
            onClick={check}
            disabled={busy || !gmail.canTrack || t.sent === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rail px-4 text-sm font-bold text-rail transition-colors hover:bg-board disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name="refresh" />
            {busy ? "Checking…" : "Check replies"}
          </button>
        </div>
      </div>

      {trackingNote && (
        <p className="mt-4 rounded-lg border border-ochre/40 bg-ochre-soft px-4 py-2.5 text-sm text-ochre">
          {trackingNote}{" "}
          <Link href="/settings#gmail" className="font-bold underline">
            Sender profile
          </Link>
        </p>
      )}
      <p role="status" className={`mt-2 min-h-5 text-sm ${notice?.tone === "bad" ? "text-specimen" : "text-ok"}`}>
        {notice?.text}
      </p>

      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label="Needs review"
          value={String(t.needsReview)}
          tone={t.expiringSoon > 0 ? "warn" : undefined}
          sub={t.expiringSoon > 0 ? `${t.expiringSoon} expiring within 2 days` : "drafts ready to approve"}
        />
        <Tile label="Sent" value={String(t.sent)} sub={`${t.sentThisWeek} in the last 7 days`} />
        <Tile
          label="Delivered"
          value={gmail.canTrack ? String(t.delivered) : "–"}
          sub={gmail.canTrack ? (t.pending > 0 ? `${t.pending} still pending` : "sent, no bounce seen") : "not tracked"}
        />
        <Tile
          label="Replied"
          value={gmail.canTrack ? String(t.replied) : "–"}
          tone={t.replied > 0 ? "ok" : undefined}
          sub={gmail.canTrack ? (t.replyRate === null ? "no deliveries yet" : `${Math.round(t.replyRate * 100)}% of delivered${t.autoReplies ? `, ${t.autoReplies} auto` : ""}`) : "not tracked"}
        />
        <Tile label="Bounced" value={gmail.canTrack ? String(t.bounced) : "–"} tone={t.bounced > 0 ? "bad" : undefined} sub={gmail.canTrack ? "address rejected" : "not tracked"} />
      </div>

      <section aria-labelledby="funnel-title" className={`${panel} mt-6 p-5`}>
        <h2 id="funnel-title" className="text-[15px] font-bold">
          Funnel
        </h2>
        <ol className="mt-3 space-y-2">
          {stats.funnel.map((step) => {
            const untracked = (step.key === "delivered" || step.key === "replied") && !gmail.canTrack;
            return (
              <li key={step.key} className="grid grid-cols-[110px_minmax(0,1fr)_48px] items-center gap-3 text-sm">
                <span className="text-ink-soft">{step.label}</span>
                <span className="h-3 overflow-hidden rounded-sm bg-board-deep" aria-hidden>
                  <span
                    className={`block h-full rounded-sm ${step.key === "replied" ? "bg-ok" : "bg-rail"}`}
                    style={{ width: untracked ? 0 : `${(step.count / top) * 100}%` }}
                  />
                </span>
                <span className="acc text-right">{untracked ? "–" : step.count}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section aria-labelledby="actions-title" className={panel}>
          <h2 id="actions-title" className="border-b border-rule px-5 py-3 text-[15px] font-bold">
            Needs your action <span className="acc font-normal text-muted">{stats.actions.length}</span>
          </h2>
          {stats.actions.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nothing waiting on you.</p>
          ) : (
            <ul>
              {stats.actions.slice(0, 12).map((a) => (
                <li key={a.runId} className="border-b border-rule-soft last:border-0">
                  <Link href={`/runs/${a.runId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-board/50">
                    <Badge tone={ACTION[a.kind].tone}>{ACTION[a.kind].label}</Badge>
                    <span className="min-w-0 flex-1 truncate font-bold">{a.label}</span>
                    <span className="acc text-[12px] text-muted">{a.dueAt ? `use by ${formatDate(a.dueAt.slice(0, 10))}` : ""}</span>
                    {a.note && <span className="basis-full text-[13px] text-ink-soft">{a.note}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="sent-title" className={panel}>
          <h2 id="sent-title" className="border-b border-rule px-5 py-3 text-[15px] font-bold">
            Sent emails <span className="acc font-normal text-muted">{stats.sentLog.length}</span>
          </h2>
          {stats.sentLog.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nothing sent yet. Approve & send a draft to see it here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-rule text-[13px] text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-bold">Prospect</th>
                    <th className="px-3 py-2.5 font-bold">Sent</th>
                    <th className="px-3 py-2.5 font-bold">Status</th>
                    <th className="px-5 py-2.5 text-right font-bold">
                      <span className="sr-only">Open in Gmail</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sentLog.map((s) => (
                    <tr key={s.runId} className="border-b border-rule-soft last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/runs/${s.runId}`} className="font-bold hover:underline">
                          {s.label}
                        </Link>
                        <div className="truncate text-[13px] text-ink-soft" title={s.subject ?? undefined}>
                          {s.subject ?? "(subject unavailable)"}
                        </div>
                        <div className="acc text-[12px] text-muted">{s.to}</div>
                      </td>
                      <td className="acc whitespace-nowrap px-3 py-3 text-[13px]">{formatDateTime(s.sentAt)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
                        {s.eventAt && <div className="acc mt-1 text-[12px] text-muted">{formatDateTime(s.eventAt)}</div>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {s.threadId && gmail.email && (
                          <a
                            href={`https://mail.google.com/mail/u/${encodeURIComponent(gmail.email)}/#all/${s.threadId}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex min-h-9 items-center gap-1 text-[13px] font-bold text-det hover:underline"
                          >
                            Gmail
                            <Icon name="external" className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <section aria-labelledby="days-title" className={`${panel} p-5`}>
          <h2 id="days-title" className="text-[15px] font-bold">
            Sends per day <span className="font-normal text-muted">last 14 days</span>
          </h2>
          <div className="mt-4 flex h-28 items-end gap-1.5" role="img" aria-label={stats.perDay.map((d) => `${d.date}: ${d.count}`).join(", ")}>
            {stats.perDay.map((d) => (
              <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${formatDate(d.date)}: ${d.count}`}>
                <div className={`rounded-sm ${d.count ? "bg-rail" : "bg-board-deep"}`} style={{ height: d.count ? `${(d.count / maxDay) * 100}%` : "3px" }} />
              </div>
            ))}
          </div>
          <div className="acc mt-2 flex justify-between text-[12px] text-muted">
            <span>{formatDate(stats.perDay[0].date)}</span>
            <span>today</span>
          </div>
        </section>

        <section aria-labelledby="hooks-title" className={`${panel} p-5`}>
          <h2 id="hooks-title" className="text-[15px] font-bold">
            What gets replies <span className="font-normal text-muted">by hook type</span>
          </h2>
          {stats.byHook.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Appears once emails are sent.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {stats.byHook.map((h) => (
                  <li key={h.hookType} className="grid grid-cols-[130px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
                    <span className="truncate text-ink-soft">{h.hookType === "role_based" ? "Role-based" : signalTypeLabel(h.hookType)}</span>
                    <span className="h-3 overflow-hidden rounded-sm bg-board-deep" aria-hidden>
                      <span className="block h-full rounded-sm bg-ok" style={{ width: `${(h.replied / h.sent) * 100}%` }} />
                    </span>
                    <span className="acc text-right">
                      {gmail.canTrack ? h.replied : "–"}/{h.sent}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-muted">Replies over sent. With only a handful of emails, treat this as a hint, not a result.</p>
            </>
          )}
        </section>
      </div>

      <div className="mt-6">
        <SystemStatus initial={providers} />
      </div>

      <p className="mt-6 text-[13px] text-muted">
        Delivered means sent with no bounce seen: Gmail has no delivery receipts. Replies and bounces come from the headers of threads Signal Scout sent; email bodies
        are never read. Opens aren&apos;t tracked.
      </p>
    </div>
  );
}
