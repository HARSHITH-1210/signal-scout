"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { ActionKind, OutreachStats, SentState } from "@/lib/outreach/stats";
import type { GmailStatus } from "@/lib/types";
import { formatDate, signalTypeLabel, type Tone } from "@/lib/ui/format";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { SystemStatus } from "./SystemStatus";
import type { ProviderStatus } from "@/lib/providers/status";
import { Spinner } from "./ui/Button";
import { Collapsible, NumberTicker, RelativeTime, Stagger, StaggerItem } from "./ui/Motion";
import { useToast } from "./ui/Toast";

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

const TONE_COLOR: Record<Tone, string> = {
  ok: "text-[var(--t-ok)]",
  info: "text-[var(--t-info)]",
  warn: "text-[var(--t-warn)]",
  bad: "text-[var(--t-bad)]",
  neutral: "text-[var(--t-muted)]",
};

const PILL = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";

/** Mono, uppercase status word in its state colour. */
function Tag({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={cn("t-label shrink-0", TONE_COLOR[tone])}>{children}</span>;
}

/** Outreach after approval, in the Telemetry direction: big numbers, a funnel track, the work queue and what came back. */
export function OutreachDashboard({ initial, gmail, providers }: { initial: OutreachStats; gmail: GmailStatus; providers: ProviderStatus[] }) {
  const [stats, setStats] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function apply(res: Awaited<ReturnType<typeof send>>, force: boolean) {
    if (!res.ok) return toast({ tone: "bad", title: "Couldn't check replies", description: res.error });
    const { result, stats: next } = res.data as { result: CheckResult; stats: OutreachStats };
    setStats(next);
    if (result.error) toast({ tone: "bad", title: "Couldn't check replies", description: result.error });
    else if (force) toast({ tone: "ok", title: result.checked ? `Checked ${result.checked} sent ${result.checked === 1 ? "email" : "emails"}` : "Nothing new to check" });
  }

  async function check() {
    setBusy(true);
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
  const tracked = gmail.canTrack;
  const top = Math.max(1, stats.funnel[0]?.count ?? 1);
  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));
  const segments = Math.max(1, stats.funnel.length - 1);
  const trackingNote = !gmail.connected
    ? "Gmail isn't connected, so replies and bounces aren't tracked."
    : !tracked
      ? "Reconnect Gmail to allow reply and bounce tracking (header-only access)."
      : null;

  return (
    <div className="telemetry">
      {/* Header: page name, live context, actions. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em]">Outreach</h1>
          <p className="t-label mt-1.5">
            {t.sent} sent · {t.sentThisWeek} this week
            {tracked && stats.lastCheckedAt && (
              <>
                {" "}
                · checked <RelativeTime iso={stats.lastCheckedAt} />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={check} disabled={busy || !tracked || t.sent === 0} className={cn(PILL, "border border-[var(--t-line)] bg-[var(--t-card)] text-[var(--t-fg)] hover:border-[var(--t-muted)]")}>
            {busy ? <Spinner /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
            {busy ? "Checking…" : "Check replies"}
          </button>
          <Link href="/runs/new" className={cn(PILL, "bg-[var(--t-inv-bg)] text-[var(--t-inv-btn)]")}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New run
          </Link>
        </div>
      </header>

      {trackingNote && (
        <p className="t-mono mt-5 rounded-xl border border-[var(--t-line)] bg-[var(--t-card)] px-4 py-2.5 text-[12px] leading-relaxed text-[var(--t-warn)]">
          <Icon name="alert" className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
          {trackingNote}{" "}
          <Link href="/settings#gmail" className="whitespace-nowrap underline underline-offset-4">
            Connect in Sender profile
          </Link>
        </p>
      )}

      {/* KPI strip */}
      <Stagger className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StaggerItem>
          <Stat label="Needs review" value={t.needsReview} accent sub={t.expiringSoon > 0 ? `${t.expiringSoon} expiring soon` : "drafts to approve"} subTone={t.expiringSoon > 0 ? "warn" : undefined} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Sent" value={t.sent} sub={`${t.sentThisWeek} in 7 days`} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Delivered" value={tracked ? t.delivered : null} sub={tracked ? (t.pending > 0 ? `${t.pending} pending` : "no bounce seen") : "not tracked"} />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Replied"
            value={tracked ? t.replied : null}
            sub={tracked ? (t.replyRate === null ? "no deliveries yet" : `${Math.round(t.replyRate * 100)}% of delivered`) : "not tracked"}
            subTone={tracked && t.replied > 0 ? "ok" : undefined}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Bounced" value={tracked ? t.bounced : null} sub={tracked ? "address rejected" : "not tracked"} subTone={t.bounced > 0 ? "bad" : undefined} />
        </StaggerItem>
      </Stagger>

      {/* Funnel track */}
      <section aria-labelledby="funnel-title" className="t-card mt-3 p-5">
        <h2 id="funnel-title" className="t-label">
          Funnel
        </h2>
        <ol
          className="mt-4 grid grid-cols-3 gap-x-1.5 gap-y-5 sm:grid-cols-[repeat(var(--steps),minmax(0,1fr))]"
          style={{ "--steps": Math.max(1, stats.funnel.length) } as React.CSSProperties}
        >
          {stats.funnel.map((step, i) => {
            const untracked = (step.key === "delivered" || step.key === "replied") && !tracked;
            const ratio = untracked ? 0 : step.count / top;
            return (
              <li key={step.key} className="flex min-w-0 flex-col gap-2 pr-4">
                <span className="block h-1 overflow-hidden rounded-full bg-[var(--t-line)]">
                  <motion.span
                    className="t-seg block h-full origin-left rounded-full"
                    style={{ width: `${Math.max(ratio, step.count > 0 ? 0.04 : 0) * 100}%`, backgroundPosition: `${(i / segments) * 100}% 0` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.2 + i * 0.06 }}
                  />
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="t-label break-words">{step.label}</span>
                  <span className="t-mono text-[12px]">{untracked ? "–" : step.count}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Work queue and sent log */}
      <section className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3">
        <article aria-labelledby="actions-title" className="t-card relative overflow-hidden">
          <span aria-hidden className="t-volt-bg absolute inset-x-0 top-0 h-[2px]" />
          <div className="flex items-center justify-between gap-3 border-b border-[var(--t-line)] px-5 py-3.5">
            <h2 id="actions-title" className="text-[15px] font-semibold tracking-[-0.01em]">
              Needs your action <span className="t-mono ml-1 text-[12px] font-normal text-[var(--t-muted)]">{stats.actions.length}</span>
            </h2>
            <Link href="/runs?view=review" className="t-mono text-[11px] text-[var(--t-muted)] hover:text-[var(--t-fg)]">
              All runs →
            </Link>
          </div>
          {stats.actions.length === 0 ? (
            <p className="px-5 py-10 text-center text-[14px] text-[var(--t-muted)]">You&apos;re all caught up. Start a run to research your next prospect.</p>
          ) : (
            <Stagger>
              <ul className="divide-y divide-[var(--t-line)]">
                {stats.actions.slice(0, 8).map((a) => (
                  <StaggerItem key={a.runId}>
                    <li>
                      <Link href={`/runs/${a.runId}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-[var(--t-pill-hover)]">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{a.label}</span>
                        <Tag tone={ACTION[a.kind].tone}>{ACTION[a.kind].label}</Tag>
                        {a.dueAt && <span className="t-mono text-[11px] text-[var(--t-muted)]">by {formatDate(a.dueAt.slice(0, 10))}</span>}
                        <span aria-hidden className="text-[var(--t-muted)] transition-transform duration-200 group-hover:translate-x-0.5">
                          →
                        </span>
                        {a.note && <span className="basis-full text-[12px] text-[var(--t-muted)]">{a.note}</span>}
                      </Link>
                    </li>
                  </StaggerItem>
                ))}
              </ul>
            </Stagger>
          )}
        </article>

        <article aria-labelledby="sent-title" className="t-card-inv overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--t-line)] px-5 py-3.5">
            <h2 id="sent-title" className="text-[15px] font-semibold tracking-[-0.01em]">
              Sent emails <span className="t-mono ml-1 text-[12px] font-normal text-[var(--t-muted)]">{stats.sentLog.length}</span>
            </h2>
            <span className="t-label">{tracked ? `${t.delivered} delivered · ${t.bounced} bounced` : "not tracked"}</span>
          </div>
          {stats.sentLog.length === 0 ? (
            <p className="px-5 py-10 text-center text-[14px] text-[var(--t-muted)]">Nothing sent yet. Approve and send a draft from a run to see it here.</p>
          ) : (
            <ul className="divide-y divide-[var(--t-line)]">
              {stats.sentLog.slice(0, 8).map((s) => (
                <li key={s.runId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/runs/${s.runId}`} className="text-[14px] font-medium hover:underline">
                      {s.label}
                    </Link>
                    <p className="truncate text-[12px] text-[var(--t-muted)]" title={s.subject ?? undefined}>
                      {s.subject ?? "(subject unavailable)"}
                    </p>
                  </div>
                  <Tag tone={STATE[s.state].tone}>{STATE[s.state].label}</Tag>
                  <RelativeTime iso={s.eventAt ?? s.sentAt} className="t-mono text-[11px] text-[var(--t-muted)]" />
                  {s.threadId && gmail.email && (
                    <a
                      href={`https://mail.google.com/mail/u/${encodeURIComponent(gmail.email)}/#all/${s.threadId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="t-mono text-[11px] text-[var(--t-muted)] underline underline-offset-4"
                    >
                      Gmail ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {/* Activity and what gets replies */}
      <section className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3">
        <article className="t-card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="t-label">Sends · last 14 days</h2>
            <span className="t-mono text-[11px] text-[var(--t-muted)]">{stats.perDay.reduce((n, d) => n + d.count, 0)} total</span>
          </div>
          <div className="mt-4 flex h-24 items-end gap-1" role="img" aria-label={`${stats.perDay.reduce((n, d) => n + d.count, 0)} sends in the last 14 days`}>
            {stats.perDay.map((d, i) => (
              <motion.span
                key={d.date}
                title={`${formatDate(d.date)}: ${d.count}`}
                className={cn("flex-1 origin-bottom rounded-[2px]", d.count ? "t-seg" : "bg-[var(--t-line)]")}
                style={{ height: d.count ? `${(d.count / maxDay) * 100}%` : "3px", backgroundPosition: `${(i / 13) * 100}% 0` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 + i * 0.025 }}
              />
            ))}
          </div>
          <div className="t-mono mt-2 flex justify-between text-[11px] text-[var(--t-muted)]">
            <span>{formatDate(stats.perDay[0].date)}</span>
            <span>today</span>
          </div>
        </article>

        <article className="t-card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="t-label">What gets replies</h2>
            <span className="t-mono text-[11px] text-[var(--t-muted)]">by hook type</span>
          </div>
          {stats.byHook.length === 0 ? (
            <p className="mt-4 text-[14px] text-[var(--t-muted)]">Reply rates by hook type appear once emails are sent.</p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {stats.byHook.map((h, i) => (
                  <li key={h.hookType} className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-3 text-[13px]">
                    <span className="truncate">{h.hookType === "role_based" ? "Role-based" : signalTypeLabel(h.hookType)}</span>
                    <span className="block h-1 overflow-hidden rounded-full bg-[var(--t-line)]">
                      <motion.span
                        className="t-seg block h-full origin-left rounded-full"
                        style={{ width: `${(h.replied / h.sent) * 100}%`, backgroundPosition: `${Math.min(100, i * 30)}% 0` }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.2 }}
                      />
                    </span>
                    <span className="t-mono text-right text-[12px]">
                      {tracked ? h.replied : "–"}/{h.sent}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-[var(--t-muted)]">Replies over sent. With only a handful of emails, treat this as a hint.</p>
            </>
          )}
        </article>
      </section>

      <section className="t-card mt-3 px-5 py-1.5">
        <Collapsible title={<span className="t-label">System status · providers and fallbacks</span>}>
          <SystemStatus initial={providers} />
        </Collapsible>
      </section>

      <p className="mt-5 max-w-[80ch] text-[12px] text-[var(--t-muted)]">
        Delivered means sent with no bounce seen: Gmail has no delivery receipts. Replies and bounces come from the headers of threads Signal Scout sent; email bodies are
        never read. Opens aren&apos;t tracked.
      </p>
    </div>
  );
}

/** Compact KPI card: mono label, medium number, one-line context. The accent stat uses the volt gradient. */
function Stat({ label, value, sub, accent = false, subTone }: { label: string; value: number | null; sub: string; accent?: boolean; subTone?: Tone }) {
  return (
    <div className="t-card relative h-full overflow-hidden p-4">
      {accent && <span aria-hidden className="t-volt-bg absolute inset-x-0 top-0 h-[2px]" />}
      <p className="t-label">{label}</p>
      <p className={cn("mt-2 text-[28px] font-medium leading-none tracking-[-0.03em]", accent && "t-volt-text")}>{value === null ? "–" : <NumberTicker value={value} />}</p>
      <p className={cn("t-mono mt-2 truncate text-[11px]", subTone ? TONE_COLOR[subTone] : "text-[var(--t-muted)]")}>{sub}</p>
    </div>
  );
}
