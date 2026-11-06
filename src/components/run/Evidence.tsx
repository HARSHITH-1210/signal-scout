import type { Hook, Identity, QueryLogEntry, Signal, Source } from "@/lib/types";
import { formatDate, FRESHNESS_LABEL, signalTypeLabel, type Tone } from "@/lib/ui/format";
import { Badge } from "../Badge";
import { Panel } from "../Field";
import { Icon } from "../Icon";

const FRESHNESS_TONE: Record<Signal["freshness"], Tone> = { fresh: "ok", aging: "neutral", stale: "warn", unknown: "neutral" };

const isDocument = (s: Source | undefined) => s?.origin === "prospect_document";

export function SourceLink({ source }: { source: Source | undefined }) {
  if (!source) return <span className="text-danger">Source missing</span>;
  if (isDocument(source))
    return (
      <span className="inline-flex items-center gap-1 font-bold text-obsidian">
        <Icon name="file" className="h-3.5 w-3.5" />
        From your document
      </span>
    );
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-bold text-info hover:underline">
      {source.domain}
      <Icon name="external" className="h-3 w-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** The determination slip pinned to a finding: the verdict, stated plainly. */
function Slip({ signal, className = "" }: { signal: Signal; className?: string }) {
  const tone =
    signal.status === "verified" ? "text-info" : signal.status === "conflicting" ? "text-danger" : "text-danger";
  const word = signal.status === "verified" ? "det. verified" : signal.status === "conflicting" ? "det. conflicting" : "det. rejected";
  return (
    <span className={`slip inline-block rounded-sm px-2 py-1 text-[11px] leading-tight ${tone} ${className}`}>
      <strong className="block text-[12px] uppercase tracking-wide">{word}</strong>
      {signal.status === "verified"
        ? `quote matched in ${signal.sourceId}${signal.corroboratingSourceIds.length ? ` + ${signal.corroboratingSourceIds.length} more` : ""}`
        : signal.status === "conflicting"
          ? "sources disagree"
          : "not used"}
    </span>
  );
}

/** The four-cell collection label under a mounted finding. */
function CollectionLabel({ signal, source }: { signal: Signal; source: Source | undefined }) {
  const cells: [string, React.ReactNode][] = [
    ["Collected from", <SourceLink key="s" source={source} />],
    ["Date", <span key="d">{formatDate(signal.eventDate ?? source?.publishedDate ?? null)}</span>],
    ["Accession", <span key="a">{signal.sourceId} / {signal.id}</span>],
    ["Reliability", <span key="r">{source?.reliabilityLabel ?? "unknown"}</span>],
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-md border border-fg/70 2xl:grid-cols-4">
      {cells.map(([label, value], i) => (
        <div
          key={label}
          className={`min-w-0 px-3 py-2 ${i % 2 === 0 ? "border-r border-fg/20" : ""} ${i < 2 ? "border-b border-fg/20 2xl:border-b-0" : ""} 2xl:border-r 2xl:last:border-r-0`}
        >
          <dt className="acc text-[11px] uppercase text-fg-muted">{label}</dt>
          <dd className="acc mt-0.5 text-[13px] break-words text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HookSpecimen({ hook, signals, sources }: { hook: Hook; signals: Signal[]; sources: Source[] }) {
  const signal = signals.find((s) => s.id === hook.signalId);
  if (!signal) return null;
  const source = sources.find((s) => s.id === signal.sourceId);
  const alternatives = signals
    .filter((s) => hook.alternativeSignalIds.includes(s.id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return (
    <section aria-labelledby="hook-title" className="relative rounded-[var(--radius-panel)] border border-line bg-surface px-5 pt-6 pb-5 sm:px-7">
      <Slip signal={signal} className="absolute -top-3 right-5 rotate-[2deg]" />
      <p className="text-[13px] text-fg-muted">
        <span id="hook-title" className="font-bold text-fg-soft">Selected hook</span>
        {"  "}
        {signalTypeLabel(signal.type)}, about the {signal.about}
      </p>
      <p className="mt-2 max-w-[38ch] text-[22px] font-bold leading-snug text-balance">{signal.claim}</p>
      {signal.statusReason && <p className="mt-1 text-[13px] text-fg-muted">{signal.statusReason}</p>}
      <blockquote className="acc mt-4 rounded-lg bg-quote px-4 py-3 text-[13px] leading-relaxed text-fg">“{signal.evidenceQuote}”</blockquote>
      <CollectionLabel signal={signal} source={source} />
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={FRESHNESS_TONE[signal.freshness]}>{FRESHNESS_LABEL[signal.freshness]}</Badge>
        <span className="acc text-fg-muted">score {hook.score.toFixed(2)}</span>
      </div>
      <p className="mt-3 text-[14px] text-fg-soft">
        <span className="font-bold text-fg">Why it matters</span> <span className="text-fg-muted">(our inference, not a fact)</span>: {hook.whyItMatters}
      </p>
      {hook.staleCaveat && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          This happened more than a year ago. The draft must refer to it with its date, never as recent news.
        </p>
      )}
      {alternatives.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] font-bold text-fg-soft">Runners-up</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {alternatives.map((a) => (
              <li key={a.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
                <span className="acc block text-fg-muted">
                  {a.id} {signalTypeLabel(a.type).toLowerCase()} {a.score?.toFixed(2)}
                </span>
                <span className="line-clamp-2">{a.claim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FindingCard({ signal, source }: { signal: Signal; source: Source | undefined }) {
  const verified = signal.status === "verified";
  return (
    <li className={`relative rounded-lg border px-4 pt-5 pb-3 ${verified ? "border-line bg-surface" : signal.status === "conflicting" ? "border-danger/30 bg-danger-soft/40" : "border-line-soft bg-canvas/40"}`}>
      <Slip signal={signal} className="absolute -top-2.5 right-3" />
      <p className="acc text-fg-muted">
        {signal.id} {signalTypeLabel(signal.type).toLowerCase()}
      </p>
      <p className={`mt-1 text-[15px] leading-snug ${verified ? "text-fg" : "text-fg-soft"}`}>{signal.claim}</p>
      <p className={`acc mt-2 text-[13px] leading-relaxed ${verified ? "rounded bg-quote px-2 py-1.5 text-fg" : signal.status === "rejected" ? "text-fg-muted line-through decoration-fg-muted/50" : "text-fg-soft"}`}>
        “{signal.evidenceQuote}”
      </p>
      {signal.statusReason && <p className={`mt-1.5 text-[13px] ${verified ? "text-fg-muted" : signal.status === "conflicting" ? "text-danger" : "text-warn"}`}>{signal.statusReason}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
        <SourceLink source={source} />
        <span className="acc">{formatDate(signal.eventDate ?? source?.publishedDate ?? null)}</span>
        <Badge tone={FRESHNESS_TONE[signal.freshness]}>{FRESHNESS_LABEL[signal.freshness]}</Badge>
        {signal.score !== null && <span className="acc">score {signal.score.toFixed(2)}</span>}
      </div>
    </li>
  );
}

export function FindingsPanel({ signals, sources }: { signals: Signal[]; sources: Source[] }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const order = { verified: 0, conflicting: 1, rejected: 2 } as const;
  const sorted = [...signals].sort((a, b) => order[a.status] - order[b.status] || (b.score ?? 0) - (a.score ?? 0));
  const count = (s: Signal["status"]) => signals.filter((x) => x.status === s).length;
  return (
    <Panel
      title={`Findings (${signals.length})`}
      aside={
        <span className="flex flex-wrap gap-1.5">
          <Badge tone="info">{count("verified")} verified</Badge>
          {count("conflicting") > 0 && <Badge tone="bad">{count("conflicting")} conflicting</Badge>}
          {count("rejected") > 0 && <Badge tone="neutral">{count("rejected")} rejected</Badge>}
        </span>
      }
    >
      <p className="-mt-2 mb-4 text-[13px] text-fg-muted">Every quote is matched word for word against the page or document it came from. Struck-through quotes failed and are never used.</p>
      {signals.length === 0 ? (
        <p className="text-sm text-fg-muted">No findings were extracted from the sources.</p>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {sorted.map((s) => (
            <FindingCard key={s.id} signal={s} source={byId.get(s.sourceId)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SourcesPanel({ sources, log }: { sources: Source[]; log: QueryLogEntry[] }) {
  return (
    <Panel title={`Sources (${sources.length})`}>
      {sources.length === 0 ? (
        <p className="text-sm text-fg-muted">No sources were collected.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[480px] table-fixed text-left text-[13px]">
            <thead className="text-fg-muted">
              <tr className="border-b border-line">
                <th className="w-10 px-1 py-2 font-bold">ID</th>
                <th className="px-1 py-2 font-bold">Title</th>
                <th className="w-[34%] px-1 py-2 font-bold">From</th>
                <th className="w-24 px-1 py-2 font-bold">Published</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-line-soft last:border-0">
                  <td className="acc px-1 py-2 text-fg-muted">{s.id}</td>
                  <td className="truncate px-1 py-2" title={s.title}>
                    {isDocument(s) ? s.title : (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-info hover:underline">
                        {s.title}
                      </a>
                    )}
                  </td>
                  <td className="truncate px-1 py-2">
                    {s.suspicious ? <span className="font-bold text-danger">Instructs AI; ignored</span> : <span className="text-fg-soft">{isDocument(s) ? "Your document" : s.domain}</span>}
                  </td>
                  <td className="acc px-1 py-2 text-fg-muted">{s.publishedDate ? formatDate(s.publishedDate) : "no date"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-fg-soft hover:text-fg">Searches run ({log.length})</summary>
          <ul className="mt-2 space-y-1 text-[13px]">
            {log.map((entry, i) => (
              <li key={i} className={entry.error ? "text-danger" : "text-fg-soft"}>
                <span className="font-bold">{entry.category}</span>: “{entry.query}”: {entry.error ? `failed (${entry.error})` : `${entry.resultCount} result(s)`}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-[13px] text-fg-muted">
        Evidence is a snapshot captured {sources[0]?.fetchedAt ? `on ${formatDate(sources[0].fetchedAt)}` : "at research time"}. A live page may have changed since.
      </p>
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
          <span className="font-bold">{identity.resolvedName ?? "No specific person"}</span>
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
                <span className="text-obsidian">Your document: {decodeURIComponent(url.slice(9))}</span>
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
    <Panel title="What this research couldn't establish">
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
