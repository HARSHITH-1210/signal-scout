"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GmailStatus, RunDetail } from "@/lib/types";
import { formatDateTime, formatMs, prospectDetail, prospectLabel, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/ui/format";
import { Badge } from "../Badge";
import { Icon } from "../Icon";
import { send } from "./api";
import { DraftEditor } from "./DraftEditor";
import { FindingsPanel, HookSpecimen, IdentityPanel, LimitationsPanel, SourcesPanel } from "./Evidence";
import { Clarify, Failed, InProgress, Insufficient, Held } from "./Outcomes";
import { PipelineDiagram } from "./PipelineDiagram";
import { useRunDetail } from "./useRunDetail";

export function RunView({ initial, gmail }: { initial: RunDetail; gmail: GmailStatus }) {
  const router = useRouter();
  const { detail, refresh, resume, connection, isActive } = useRunDetail(initial);
  const [deleting, setDeleting] = useState(false);
  const p = detail.prospect;
  const subtitle = prospectDetail(p, detail.resolvedLabel);
  const latestDraft = detail.drafts[detail.drafts.length - 1];
  const showLimitations = detail.status !== "insufficient_research";

  async function remove() {
    if (!window.confirm("Delete this run and everything it collected? This can't be undone.")) return;
    setDeleting(true);
    const result = await send(`/api/runs/${detail.id}`, "DELETE");
    if (result.ok) router.push("/runs");
    else {
      setDeleting(false);
      window.alert(result.error);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/runs" className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="h-3.5 w-3.5" />
          All runs
        </Link>
        {!isActive && (
          <button onClick={remove} disabled={deleting} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-specimen-soft hover:text-specimen">
            <Icon name="trash" />
            {deleting ? "Deleting…" : "Delete run"}
          </button>
        )}
      </div>

      <header className="mt-2 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div className="min-w-0">

          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.01em] text-balance">{prospectLabel(p, detail.resolvedLabel)}</h1>
          {subtitle && <p className="mt-0.5 text-[16px] text-ink-soft">{subtitle}</p>}
          <p className="acc mt-1.5 text-muted">
            Run {detail.id.slice(0, 8)}, accessioned {formatDateTime(detail.createdAt)}
            {detail.activeMs >= 1000 && !isActive ? `, ${formatMs(detail.activeMs)} active` : ""}
          </p>
          {detail.documents.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {detail.documents.map((d) => (
                <li key={`${d.documentId}-${d.rowIndex}`} className="inline-flex items-center gap-1.5 rounded-md bg-paper px-2 py-1 text-[13px] text-ink-soft">
                  <Icon name={d.kind === "csv" ? "table" : "file"} className="h-3.5 w-3.5 text-rail" />
                  {d.name}
                  {d.rowIndex !== null ? `, row ${d.rowIndex + 1}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Badge tone={RUN_STATUS_TONE[detail.status]} live={isActive}>
            {RUN_STATUS_LABEL[detail.status]}
          </Badge>
          {isActive && connection === "reconnecting" && <span className="text-[13px] text-muted">Reconnecting to live updates…</span>}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_420px]">
        <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Pipeline progress">
          <div className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5">
            <h2 className="mb-3 text-[15px] font-bold">Accession ledger</h2>
            <PipelineDiagram statuses={detail.stageStatuses} events={detail.events} runStatus={detail.status} />
            {detail.events.length > 0 && (
              <details className="mt-4 text-[13px]">
                <summary className="cursor-pointer text-ink-soft hover:text-ink">Full activity log ({detail.events.length})</summary>
                <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {detail.events.map((e) => (
                    <li key={e.id} className="text-ink-soft">
                      <span className="acc text-muted">{new Date(e.createdAt).toLocaleTimeString()}</span> {e.message}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          {isActive && <InProgress detail={detail} />}
          {detail.status === "needs_clarification" && <Clarify detail={detail} onResumed={resume} />}
          {detail.status === "held" && <Held detail={detail} onResumed={resume} />}
          {detail.status === "insufficient_research" && <Insufficient detail={detail} onResumed={resume} />}
          {detail.status === "failed" && <Failed detail={detail} onResumed={resume} />}
          {/* On narrower screens the draft sits here, right after the outcome. */}
          {latestDraft && !isActive && (
            <div className="xl:hidden">
              <DraftEditor key={latestDraft.id} detail={detail} gmail={gmail} onChanged={refresh} onResumed={resume} />
            </div>
          )}
          {detail.hook && <HookSpecimen hook={detail.hook} signals={detail.signals} sources={detail.sources} />}
          {showLimitations && <LimitationsPanel limitations={detail.limitations} />}
          {detail.signals.length > 0 && <FindingsPanel signals={detail.signals} sources={detail.sources} />}
          {detail.identity && <IdentityPanel identity={detail.identity} />}
          {(detail.sources.length > 0 || detail.researchLog.length > 0) && <SourcesPanel sources={detail.sources} log={detail.researchLog} />}
        </div>

        <div className="hidden xl:block">
          <div className="xl:sticky xl:top-6">
            {latestDraft && !isActive ? (
              <DraftEditor key={latestDraft.id} detail={detail} gmail={gmail} onChanged={refresh} onResumed={resume} />
            ) : (
              <div className="rounded-[var(--radius-panel)] border border-dashed border-rule p-6 text-sm text-muted">
                <p className="font-bold text-ink-soft">The draft appears here</p>
                <p className="mt-1">Once a hook is verified, Signal Scout writes a structured draft built on it, then audits every claim.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
