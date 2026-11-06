"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { ActionKind, OutreachStats, SentState } from "@/lib/outreach/stats";
import type { GmailStatus } from "@/lib/types";
import { formatDate, signalTypeLabel, type Tone } from "@/lib/ui/format";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { SystemStatus } from "./SystemStatus";
import type { ProviderStatus } from "@/lib/providers/status";
import { Button, buttonClass } from "./ui/Button";
import { Card, EmptyState, PageHeader } from "./ui/Card";
import { Collapsible, NumberTicker, RelativeTime, SpotlightCard, Stagger, StaggerItem } from "./ui/Motion";
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

function Tile({ label, value, sub, tone }: { label: string; value: number | null; sub: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-danger" : "text-fg";
  return (
    <SpotlightCard className="h-full p-5">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className={cn("mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em]", color)}>{value === null ? "–" : <NumberTicker value={value} />}</p>
      <p className="mt-2 text-[13px] text-fg-muted">{sub}</p>
    </SpotlightCard>
  );
}

/** A horizontal bar that grows from the left when it first renders. */
function Bar({ ratio, tone = "obsidian" }: { ratio: number; tone?: "obsidian" | "ok" }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
      <motion.span
        className={cn("block h-full origin-left rounded-full", tone === "ok" ? "bg-ok" : "bg-obsidian")}
        style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.15 }}
      />
    </span>
  );
}

function SectionTitle({ id, children, count }: { id: string; children: React.ReactNode; count?: number }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
      {children}
      {count !== undefined && <span className="acc rounded-full bg-subtle px-2 py-0.5 text-[11px] font-normal text-fg-muted">{count}</span>}
    </h2>
  );
}

/** Outreach after approval: what's waiting on the rep, what was sent, and what came back. */
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
  const top = Math.max(1, stats.funnel[0]?.count ?? 1);
  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));
  const tracked = gmail.canTrack;
  const trackingNote = !gmail.connected
    ? "Gmail isn't connected, so replies and bounces aren't tracked."
    : !tracked
      ? "Reconnect Gmail to allow reply and bounce tracking (header-only access)."
      : null;

  return (
    <div>
      <PageHeader
        title="Outreach"
        description="What's waiting on you, what was sent, and what came back."
        actions={
          <>
            {tracked && stats.lastCheckedAt && (
              <span className="text-[13px] text-fg-muted">
                Checked <RelativeTime iso={stats.lastCheckedAt} />
              </span>
            )}
            <Button onClick={check} loading={busy} disabled={!tracked || t.sent === 0}>
              {!busy && <Icon name="refresh" />}
              {busy ? "Checking…" : "Check replies"}
            </Button>
            <Link href="/runs/new" className={buttonClass("primary")}>
              <Icon name="plus" />
              New run
            </Link>
          </>
        }
      />

      {trackingNote && (
        <p className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
          <Icon name="alert" />
          {trackingNote}
          <Link href="/settings#gmail" className="font-medium underline">
            Connect in Sender profile
          </Link>
        </p>
      )}

      {/* What needs the rep comes first. */}
      <Card className="mb-6">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <SectionTitle id="actions-title" count={stats.actions.length}>
            Needs your action
          </SectionTitle>
        </div>
        {stats.actions.length === 0 ? (
          <EmptyState icon="check" title="You're all caught up" className="py-10">
            Nothing is waiting on you. Start a run to research your next prospect.
          </EmptyState>
        ) : (
          <Stagger>
            <ul aria-labelledby="actions-title">
              {stats.actions.slice(0, 12).map((a) => (
                <StaggerItem key={a.runId}>
                  <li className="border-b border-line-soft last:border-0">
                    <Link href={`/runs/${a.runId}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 transition-colors hover:bg-subtle/60">
                      <Badge tone={ACTION[a.kind].tone}>{ACTION[a.kind].label}</Badge>
                      <span className="min-w-0 flex-1 truncate font-medium">{a.label}</span>
                      {a.dueAt && <span className="acc text-fg-muted">use by {formatDate(a.dueAt.slice(0, 10))}</span>}
                      <Icon name="arrowRight" className="h-3.5 w-3.5 text-fg-muted transition-transform duration-200 group-hover:translate-x-0.5" />
                      {a.note && <span className="basis-full text-[13px] text-fg-muted">{a.note}</span>}
                    </Link>
                  </li>
                </StaggerItem>
              ))}
            </ul>
          </Stagger>
        )}
      </Card>

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StaggerItem>
          <Tile
            label="Needs review"
            value={t.needsReview}
            tone={t.expiringSoon > 0 ? "warn" : undefined}
            sub={t.expiringSoon > 0 ? `${t.expiringSoon} expiring within 2 days` : "drafts ready to approve"}
          />
        </StaggerItem>
        <StaggerItem>
          <Tile label="Sent" value={t.sent} sub={`${t.sentThisWeek} in the last 7 days`} />
        </StaggerItem>
        <StaggerItem>
          <Tile label="Delivered" value={tracked ? t.delivered : null} sub={tracked ? (t.pending > 0 ? `${t.pending} still pending` : "sent, no bounce seen") : "not tracked"} />
        </StaggerItem>
        <StaggerItem>
          <Tile
            label="Replied"
            value={tracked ? t.replied : null}
            tone={t.replied > 0 ? "ok" : undefined}
            sub={tracked ? (t.replyRate === null ? "no deliveries yet" : `${Math.round(t.replyRate * 100)}% of delivered${t.autoReplies ? `, ${t.autoReplies} auto` : ""}`) : "not tracked"}
          />
        </StaggerItem>
        <StaggerItem>
          <Tile label="Bounced" value={tracked ? t.bounced : null} tone={t.bounced > 0 ? "bad" : undefined} sub={tracked ? "address rejected" : "not tracked"} />
        </StaggerItem>
      </Stagger>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="p-5">
          <SectionTitle id="funnel-title">Funnel</SectionTitle>
          <ol aria-labelledby="funnel-title" className="mt-4 space-y-3">
            {stats.funnel.map((step) => {
              const untracked = (step.key === "delivered" || step.key === "replied") && !tracked;
              return (
                <li key={step.key} className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
                  <span className="text-fg-soft">{step.label}</span>
                  <Bar ratio={untracked ? 0 : step.count / top} tone={step.key === "replied" ? "ok" : "obsidian"} />
                  <span className="acc text-right">{untracked ? "–" : step.count}</span>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card>
          <div className="border-b border-line px-5 py-4">
            <SectionTitle id="sent-title" count={stats.sentLog.length}>
              Sent emails
            </SectionTitle>
          </div>
          {stats.sentLog.length === 0 ? (
            <EmptyState icon="mail" title="Nothing sent yet" className="py-10">
              Approve and send a draft from a run to see it here.
            </EmptyState>
          ) : (
            <ul aria-labelledby="sent-title" className="divide-y divide-line-soft">
              {stats.sentLog.map((s) => (
                <li key={s.runId} className="grid gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <Link href={`/runs/${s.runId}`} className="font-medium hover:underline">
                      {s.label}
                    </Link>
                    <p className="truncate text-[13px] text-fg-soft" title={s.subject ?? undefined}>
                      {s.subject ?? "(subject unavailable)"}
                    </p>
                    <p className="acc truncate text-fg-muted">{s.to}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                    <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
                    <RelativeTime iso={s.eventAt ?? s.sentAt} className="acc text-fg-muted" />
                  </div>
                  <div className="sm:text-right">
                    {s.threadId && gmail.email && (
                      <a
                        href={`https://mail.google.com/mail/u/${encodeURIComponent(gmail.email)}/#all/${s.threadId}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-info hover:bg-info-soft"
                      >
                        Gmail
                        <Icon name="external" className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle id="days-title">
            Sends per day <span className="font-normal text-fg-muted">· last 14 days</span>
          </SectionTitle>
          <div className="mt-5 flex h-28 items-end gap-1.5" role="img" aria-label={`Sends per day over the last 14 days, ${stats.perDay.reduce((n, d) => n + d.count, 0)} in total.`}>
            {stats.perDay.map((d, i) => (
              <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${formatDate(d.date)}: ${d.count}`}>
                <motion.div
                  className={cn("origin-bottom rounded-[3px]", d.count ? "bg-obsidian" : "bg-subtle")}
                  style={{ height: d.count ? `${(d.count / maxDay) * 100}%` : "3px" }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 + i * 0.025 }}
                />
              </div>
            ))}
          </div>
          <div className="acc mt-2 flex justify-between text-fg-muted">
            <span>{formatDate(stats.perDay[0].date)}</span>
            <span>today</span>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle id="hooks-title">
            What gets replies <span className="font-normal text-fg-muted">· by hook type</span>
          </SectionTitle>
          {stats.byHook.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">Appears once emails are sent.</p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {stats.byHook.map((h) => (
                  <li key={h.hookType} className="grid grid-cols-[120px_minmax(0,1fr)_56px] items-center gap-3 text-sm">
                    <span className="truncate text-fg-soft">{h.hookType === "role_based" ? "Role-based" : signalTypeLabel(h.hookType)}</span>
                    <Bar ratio={h.replied / h.sent} tone="ok" />
                    <span className="acc text-right">
                      {tracked ? h.replied : "–"}/{h.sent}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] text-fg-muted">Replies over sent. With only a handful of emails, treat this as a hint, not a result.</p>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6 px-5 py-2">
        <Collapsible title="System status" aside={<span className="text-[13px] font-normal text-fg-muted">Providers and fallbacks</span>}>
          <SystemStatus initial={providers} />
        </Collapsible>
      </Card>

      <p className="mt-6 max-w-[80ch] text-[13px] text-fg-muted">
        Delivered means sent with no bounce seen: Gmail has no delivery receipts. Replies and bounces come from the headers of threads Signal Scout sent; email bodies are
        never read. Opens aren&apos;t tracked.
      </p>
    </div>
  );
}
