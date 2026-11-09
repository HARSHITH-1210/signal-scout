"use client";

import { motion } from "motion/react";
import type { Hook, Identity, QueryLogEntry, Signal, Source } from "@/lib/types";
import { formatDate, FRESHNESS_LABEL, signalTypeLabel, type Tone } from "@/lib/ui/format";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Badge } from "../Badge";
import { Panel } from "../Field";
import { Icon } from "../Icon";
import { CopyButton } from "../ui/CopyButton";
import { InfoTip } from "../ui/Tooltip";
import { Collapsible, Stagger, StaggerItem } from "../ui/Motion";

const FRESHNESS_TONE: Record<Signal["freshness"], Tone> = { fresh: "ok", aging: "neutral", stale: "warn", unknown: "neutral" };
const FRESHNESS_DOT: Record<Signal["freshness"], string> = { fresh: "bg-ok", aging: "bg-fg-muted", stale: "bg-warn", unknown: "bg-line" };

const isDocument = (s: Source | undefined) => s?.origin === "prospect_document";

export function SourceLink({ source }: { source: Source | undefined }) {
  if (!source) return <span className="text-danger">Source missing</span>;
  if (isDocument(source))
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[12px] font-medium text-fg-soft">
        <Icon name="file" className="h-3.5 w-3.5" />
        Your document
      </span>
    );
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={source.title}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface py-0.5 pl-0.5 pr-1.5 text-[12px] font-medium text-fg-soft transition-colors hover:border-fg-muted/40 hover:text-fg"
    >
      <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded bg-subtle text-[10px] font-semibold uppercase text-fg-muted">
        {source.domain.replace(/^www\./, "").charAt(0)}
      </span>
      <span className="truncate">{source.domain}</span>
      <Icon name="external" className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Compact freshness: a coloured dot and the short word; the full meaning is in the tooltip. */
function Freshness({ signal, source }: { signal: Signal; source: Source | undefined }) {
  const date = formatDate(signal.eventDate ?? source?.publishedDate ?? null);
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted" title={`${FRESHNESS_LABEL[signal.freshness]} · ${date}`}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", FRESHNESS_DOT[signal.freshness])} />
      <span className="sr-only">Freshness: </span>
      {FRESHNESS_LABEL[signal.freshness]}
      <span className="acc">· {date}</span>
    </span>
  );
}

/** The verdict on a finding, stated plainly. */
function Verdict({ signal }: { signal: Signal }) {
  const verified = signal.status === "verified";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", verified ? "bg-info-soft text-info" : "bg-danger-soft text-danger")}>
      <Icon name={verified ? "check" : signal.status === "conflicting" ? "alert" : "cross"} className="h-3 w-3" />
      {verified
        ? `Verified in ${signal.sourceId}${signal.corroboratingSourceIds.length ? ` +${signal.corroboratingSourceIds.length}` : ""}`
        : signal.status === "conflicting"
          ? "Sources disagree"
          : "Rejected, not used"}
    </span>
  );
}

function Quote({ text, struck = false }: { text: string; struck?: boolean }) {
  return (
    <figure className="group/quote relative mt-3">
      <blockquote
        className={cn(
          "acc rounded-lg border-l-2 py-2.5 pl-3.5 pr-9 text-[12.5px] leading-relaxed",
          struck ? "border-line bg-transparent text-fg-muted line-through decoration-fg-muted/50" : "border-obsidian/70 bg-quote text-fg",
        )}
      >
        “{text}”
      </blockquote>
      {!struck && <CopyButton text={text} label="Copy quote" className="absolute right-1.5 top-1.5 opacity-0 focus-visible:opacity-100 group-hover/quote:opacity-100" />}
    </figure>
  );
}

export function HookSpecimen({ hook, signals, sources }: { hook: Hook; signals: Signal[]; sources: Source[] }) {
  const signal = signals.find((s) => s.id === hook.signalId);
  if (!signal) return null;
  const source = sources.find((s) => s.id === signal.sourceId);
  const alternatives = signals.filter((s) => hook.alternativeSignalIds.includes(s.id)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return (
    <section aria-labelledby="hook-title" className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <span aria-hidden className="t-volt-bg absolute inset-x-0 top-0 h-[3px]" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5 sm:px-6">
        <p className="t-label flex flex-wrap items-center gap-x-2">
          <span id="hook-title" className="text-fg">
            The hook
          </span>
          <span>
            · {signalTypeLabel(signal.type)} · about the {signal.about}
          </span>
        </p>
        <span className="t-label">
          score <span className="t-volt-text text-[13px] font-medium">{hook.score.toFixed(2)}</span>
        </span>
      </div>
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Verdict signal={signal} />
          <Badge tone={FRESHNESS_TONE[signal.freshness]}>{FRESHNESS_LABEL[signal.freshness]}</Badge>
        </div>
        <p className="mt-3 max-w-[52ch] text-[19px] font-medium leading-snug tracking-[-0.015em] text-balance">{signal.claim}</p>
        {signal.statusReason && <p className="mt-1 text-[13px] text-fg-muted">{signal.statusReason}</p>}
        <Quote text={signal.evidenceQuote} />
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
          {(
            [
              ["Source", <SourceLink key="s" source={source} />],
              ["Date", <span key="d" className="acc">{formatDate(signal.eventDate ?? source?.publishedDate ?? null)}</span>],
              ["Reference", <span key="a" className="acc">{signal.sourceId} / {signal.id}</span>],
              ["Reliability", <span key="r">{source?.reliabilityLabel ?? "unknown"}</span>],
            ] as [string, React.ReactNode][]
          ).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{label}</dt>
              <dd className="mt-1 min-w-0 break-words text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 rounded-xl border border-line-soft bg-subtle/50 px-4 py-3 text-sm text-fg-soft">
          <span className="font-medium text-fg">Why it matters</span> <span className="text-[12px] text-fg-muted">(our inference, not a fact)</span>
          <p className="mt-1">{hook.whyItMatters}</p>
        </div>
        {hook.staleCaveat && (
          <p className="mt-3 flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0" />
            Over a year old. The draft must date it, never call it recent.
          </p>
        )}
        {alternatives.length > 0 && (
          <div className="mt-5">
            <p className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">Runners-up</p>
            <Stagger className="mt-2 grid gap-2 sm:grid-cols-3">
              {alternatives.map((a) => (
                <StaggerItem key={a.id} className="rounded-lg border border-line px-3 py-2.5 text-[13px] transition-colors hover:border-fg-muted/40">
                  <span className="acc block text-fg-muted">
                    {signalTypeLabel(a.type)} · {a.score?.toFixed(2)}
                  </span>
                  <span className="mt-0.5 line-clamp-2">{a.claim}</span>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        )}
      </div>
    </section>
  );
}

function FindingCard({ signal, source }: { signal: Signal; source: Source | undefined }) {
  const verified = signal.status === "verified";
  return (
    <div
      className={cn(
        "h-full rounded-xl border p-4 transition-[border-color,box-shadow] duration-200",
        verified ? "border-line bg-surface hover:border-fg-muted/30 hover:shadow-[0_4px_20px_-10px_rgb(0_0_0/0.2)]" : signal.status === "conflicting" ? "border-danger/25 bg-danger-soft/40" : "border-line-soft bg-subtle/40",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-muted">{signalTypeLabel(signal.type)}</span>
        <Verdict signal={signal} />
      </div>
      <p className={cn("mt-2 text-[15px] leading-snug", verified ? "text-fg" : "text-fg-soft")}>{signal.claim}</p>
      <Quote text={signal.evidenceQuote} struck={signal.status === "rejected"} />
      {signal.statusReason && <p className={cn("mt-2 text-[13px]", verified ? "text-fg-muted" : signal.status === "conflicting" ? "text-danger" : "text-warn")}>{signal.statusReason}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SourceLink source={source} />
        <Freshness signal={signal} source={source} />
        {signal.score !== null && <span className="acc text-fg-muted">score {signal.score.toFixed(2)}</span>}
      </div>
    </div>
  );
}

export function FindingsPanel({ signals, sources }: { signals: Signal[]; sources: Source[] }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const order = { verified: 0, conflicting: 1, rejected: 2 } as const;
  const sorted = [...signals].sort((a, b) => order[a.status] - order[b.status] || (b.score ?? 0) - (a.score ?? 0));
  const count = (s: Signal["status"]) => signals.filter((x) => x.status === s).length;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge tone="info">{count("verified")} verified</Badge>
        {count("conflicting") > 0 && <Badge tone="bad">{count("conflicting")} conflicting</Badge>}
        {count("rejected") > 0 && <Badge tone="neutral">{count("rejected")} rejected</Badge>}
        <InfoTip label="How findings are verified" align="start">
          Every quote is matched word for word against its source. Struck-through quotes failed and are never used.
        </InfoTip>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {sorted.map((s, i) => (
          <motion.li key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(i, 8) * 0.04 }}>
            <FindingCard signal={s} source={byId.get(s.sourceId)} />
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export function SourcesPanel({ sources, log }: { sources: Source[]; log: QueryLogEntry[] }) {
  return (
    <Panel>
      {sources.length === 0 ? (
        <p className="text-sm text-fg-muted">No sources were collected.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line-soft">
          {sources.map((s) => (
            <li key={s.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-2 rounded-lg px-2 py-2.5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-center">
              <span className="acc pt-0.5 text-fg-muted">{s.id}</span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium" title={s.title}>
                  {isDocument(s) ? (
                    s.title
                  ) : (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {s.title}
                    </a>
                  )}
                </p>
                <p className="truncate text-[12px]">
                  {s.suspicious ? <span className="font-medium text-danger">Instructs AI; ignored</span> : <span className="text-fg-muted">{isDocument(s) ? "Your document" : s.domain}</span>}
                </p>
              </div>
              <span className="acc col-start-2 text-fg-muted sm:col-start-auto">{s.publishedDate ? formatDate(s.publishedDate) : "no date"}</span>
            </li>
          ))}
        </ul>
      )}
      {log.length > 0 && (
        <Collapsible className="mt-3 border-t border-line-soft pt-2" title={<span className="text-fg-soft">Searches run ({log.length})</span>}>
          <ul className="space-y-1 text-[13px]">
            {log.map((entry, i) => (
              <li key={i} className={entry.error ? "text-danger" : "text-fg-soft"}>
                <span className="font-medium">{entry.category}</span>: “{entry.query}”: {entry.error ? `failed (${entry.error})` : `${entry.resultCount} result(s)`}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      <p className="t-label mt-3">Snapshot {sources[0]?.fetchedAt ? `from ${formatDate(sources[0].fetchedAt)}` : "from research time"}</p>
    </Panel>
  );
}

export function IdentityPanel({ identity }: { identity: Identity }) {
  const tone: Tone = identity.status === "resolved" ? (identity.personConfirmed ? "ok" : "warn") : identity.status === "ambiguous" ? "warn" : "bad";
  const label =
    identity.status === "resolved"
      ? identity.confirmedByUser
        ? "Confirmed by you"
        : identity.personConfirmed
          ? "Person and company confirmed"
          : "Company confirmed, person not confirmed"
      : identity.status === "ambiguous"
        ? "Several possible matches"
        : "Not found";
  return (
    <Panel title="Identity" aside={<Badge tone={tone}>{label}</Badge>}>
      {identity.resolvedName || identity.resolvedCompany ? (
        <p className="text-[15px]">
          <span className="font-medium">{identity.resolvedName ?? "No specific person"}</span>
          {identity.resolvedRole ? `, ${identity.resolvedRole}` : ""}
          {identity.resolvedCompany ? ` at ${identity.resolvedCompany}` : ""}
          {identity.companyDomain && <span className="acc ml-2 text-fg-muted">{identity.companyDomain}</span>}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-fg-soft">{identity.reasoning}</p>
      {identity.evidenceUrls.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {identity.evidenceUrls.map((url) => (
            <li key={url} className="min-w-0 truncate">
              {url.startsWith("upload://") ? (
                <span className="text-fg-soft">Your document: {decodeURIComponent(url.slice(9))}</span>
              ) : (
                <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="acc text-info hover:underline">
                  {url}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function LimitationsPanel({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;
  return (
    <Panel title="What this research couldn't establish" className="border-warn/20">
      <ul className="space-y-1.5 text-sm text-fg-soft">
        {limitations.map((l, i) => (
          <li key={i} className="flex gap-2">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            {l}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
