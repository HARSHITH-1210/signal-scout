"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { STAGES, STAGE_LABELS, type GmailStatus, type RunDetail } from "@/lib/types";
import { formatDateTime, formatMs, prospectDetail, prospectLabel, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/ui/format";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Badge } from "../Badge";
import { Icon } from "../Icon";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useConfirm } from "../ui/Dialog";
import { RiseIn } from "../ui/Motion";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/Toast";
import { send } from "./api";
import { DraftEditor } from "./DraftEditor";
import { FindingsPanel, HookSpecimen, IdentityPanel, LimitationsPanel, SourcesPanel } from "./Evidence";
import { Clarify, Failed, InProgress, Insufficient, Held } from "./Outcomes";
import { DegradedBanner, ProvenancePanel } from "./Provenance";
import { PipelineDiagram } from "./PipelineDiagram";
import { useRunDetail } from "./useRunDetail";

type EvidenceTab = "findings" | "sources" | "identity" | "activity";

/*
 * One grid, one DraftEditor. Areas reorder by breakpoint so the draft follows the outcome on narrow
 * screens and sits in its own sticky column on wide ones, without mounting a second copy.
 */
const GRID = cn(
  "grid gap-6",
  "[grid-template-areas:'outcome'_'draft'_'evidence'_'pipeline']",
  "lg:grid-cols-[260px_minmax(0,1fr)] lg:[grid-template-areas:'pipeline_outcome'_'pipeline_draft'_'pipeline_evidence']",
  "xl:grid-cols-[260px_minmax(0,1fr)_440px] xl:grid-rows-[auto_1fr] xl:[grid-template-areas:'pipeline_outcome_draft'_'pipeline_evidence_draft']",
);

export function RunView({ initial, gmail }: { initial: RunDetail; gmail: GmailStatus }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { detail, refresh, resume, connection, isActive } = useRunDetail(initial);
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [tab, setTab] = useState<EvidenceTab>("findings");
  const p = detail.prospect;
  const subtitle = prospectDetail(p, detail.resolvedLabel);
  const latestDraft = detail.drafts[detail.drafts.length - 1];
  const showLimitations = detail.status !== "insufficient_research";
  const stageIndex = detail.currentStage ? STAGES.indexOf(detail.currentStage) : -1;

  async function stop() {
    const ok = await confirm({
      title: "Stop this run?",
      description: "Everything found so far is kept, and you can resume it later.",
      confirmLabel: "Stop run",
      tone: "danger",
    });
    if (!ok) return;
    setStopping(true);
    const result = await send(`/api/runs/${detail.id}/stop`, "POST");
    setStopping(false);
    if (!result.ok) toast({ tone: "bad", title: "Couldn't stop the run", description: result.error });
    else toast({ tone: "ok", title: "Run stopped" });
    refresh();
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this run?",
      description: "The run and everything it collected are removed. This can't be undone.",
      confirmLabel: "Delete run",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    const result = await send(`/api/runs/${detail.id}`, "DELETE");
    if (result.ok) {
      toast({ tone: "ok", title: "Run deleted" });
      router.push("/runs");
    } else {
      setDeleting(false);
      toast({ tone: "bad", title: "Couldn't delete the run", description: result.error });
    }
  }

  const tabs = [
    { value: "findings" as const, label: "Findings", count: detail.signals.length },
    { value: "sources" as const, label: "Sources", count: detail.sources.length },
    ...(detail.identity ? [{ value: "identity" as const, label: "Identity" }] : []),
    { value: "activity" as const, label: "Activity", count: detail.events.length },
  ];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : "findings";

  return (
    <div>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center justify-between gap-3">
        <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
          <li>
            <Link href="/runs" className="inline-flex min-h-9 items-center gap-1 rounded-md hover:text-fg">
              <Icon name="arrowLeft" className="h-3.5 w-3.5" />
              Runs
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="truncate text-fg-soft">
            {prospectLabel(p, detail.resolvedLabel)}
          </li>
        </ol>
        {isActive ? (
          <Button size="sm" variant="danger" onClick={stop} loading={stopping}>
            {!stopping && <Icon name="stop" className="h-3.5 w-3.5" />}
            {stopping ? "Stopping…" : "Stop run"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={remove} loading={deleting} className="hover:bg-danger-soft hover:text-danger">
            {!deleting && <Icon name="trash" className="h-3.5 w-3.5" />}
            {deleting ? "Deleting…" : "Delete run"}
          </Button>
        )}
      </nav>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <motion.h1
            initial={{ opacity: 0, y: 12, clipPath: "inset(0 0 100% 0)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)" }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-balance"
          >
            {prospectLabel(p, detail.resolvedLabel)}
          </motion.h1>
          {subtitle && <p className="mt-1 text-[14px] text-fg-soft">{subtitle}</p>}
          <p className="t-label mt-2">
            Run {detail.id.slice(0, 8)} · started {formatDateTime(detail.createdAt)}
            {detail.activeMs >= 1000 && !isActive ? ` · ${formatMs(detail.activeMs)} active` : ""}
          </p>
          {detail.documents.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {detail.documents.map((d) => (
                <li key={`${d.documentId}-${d.rowIndex}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-fg-soft">
                  <Icon name={d.kind === "csv" ? "table" : "file"} className="h-3.5 w-3.5 text-fg-muted" />
                  {d.name}
                  {d.rowIndex !== null ? `, row ${d.rowIndex + 1}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={RUN_STATUS_TONE[detail.status]} live={isActive}>
              {RUN_STATUS_LABEL[detail.status]}
            </Badge>
            {(detail.degraded?.length ?? 0) > 0 && <Badge tone="warn">Degraded</Badge>}
          </span>
          {/* Compact progress for narrow screens, where the full pipeline sits at the bottom. */}
          {isActive && stageIndex >= 0 && (
            <span className="flex items-center gap-2 text-[13px] text-fg-muted lg:hidden">
              {STAGE_LABELS[STAGES[stageIndex]]} · {stageIndex + 1}/{STAGES.length}
              <span className="h-1 w-16 overflow-hidden rounded-full bg-subtle">
                <motion.span className="block h-full rounded-full bg-obsidian" animate={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }} transition={{ duration: 0.4, ease: EASE_OUT }} />
              </span>
            </span>
          )}
          {isActive && connection === "reconnecting" && <span className="text-[13px] text-fg-muted">Reconnecting to live updates…</span>}
        </div>
      </header>

      <div className={cn("mt-6", GRID)}>
        <aside className="[grid-area:pipeline] lg:sticky lg:top-20 lg:self-start" aria-label="Pipeline progress">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">Pipeline</h2>
            <PipelineDiagram statuses={detail.stageStatuses} events={detail.events} runStatus={detail.status} />
          </Card>
        </aside>

        <div className="min-w-0 space-y-6 [grid-area:outcome]">
          <DegradedBanner degraded={detail.degraded ?? []} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={detail.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="space-y-6 empty:hidden">
              {isActive && <InProgress detail={detail} />}
              {detail.status === "needs_clarification" && <Clarify detail={detail} onResumed={resume} />}
              {detail.status === "held" && <Held detail={detail} onResumed={resume} />}
              {detail.status === "insufficient_research" && <Insufficient detail={detail} onResumed={resume} />}
              {(detail.status === "failed" || detail.status === "stopped") && <Failed detail={detail} onResumed={resume} />}
            </motion.div>
          </AnimatePresence>
          {detail.hook && (
            <RiseIn>
              <HookSpecimen hook={detail.hook} signals={detail.signals} sources={detail.sources} />
            </RiseIn>
          )}
          {showLimitations && <LimitationsPanel limitations={detail.limitations} />}
        </div>

        <div className="min-w-0 [grid-area:draft] xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:rounded-[var(--radius-panel)] xl:[scrollbar-width:thin]">
          {latestDraft && !isActive ? (
            <RiseIn>
              <DraftEditor key={latestDraft.id} detail={detail} gmail={gmail} onChanged={refresh} onResumed={resume} />
            </RiseIn>
          ) : (
            <div className="hidden rounded-[var(--radius-panel)] border border-dashed border-line p-6 text-sm text-fg-muted xl:block">
              <span className="mb-3 grid h-9 w-9 place-items-center rounded-full border border-line text-fg-muted">
                <Icon name="mail" />
              </span>
              <p className="font-medium text-fg-soft">The draft appears here</p>
            </div>
          )}
        </div>

        <section aria-label="Evidence" className="min-w-0 [grid-area:evidence]">
          <Tabs label="Evidence" items={tabs} value={activeTab} onChange={setTab} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="mt-4 space-y-6">
              {activeTab === "findings" &&
                (detail.signals.length > 0 ? (
                  <FindingsPanel signals={detail.signals} sources={detail.sources} />
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-fg-muted">{isActive ? "Findings appear as sources are read and verified." : "No findings were extracted."}</p>
                ))}
              {activeTab === "sources" &&
                (detail.sources.length > 0 || detail.researchLog.length > 0 ? (
                  <SourcesPanel sources={detail.sources} log={detail.researchLog} />
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-fg-muted">No sources yet.</p>
                ))}
              {activeTab === "identity" && detail.identity && <IdentityPanel identity={detail.identity} />}
              {activeTab === "activity" && (
                <>
                  <Card className="p-5">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Activity log</h2>
                    {detail.events.length === 0 ? (
                      <p className="mt-2 text-sm text-fg-muted">Nothing yet.</p>
                    ) : (
                      <ol className="relative mt-4 max-h-96 space-y-3 overflow-y-auto border-l border-line pl-4 text-[13px]">
                        {detail.events.map((e) => (
                          <li key={e.id} className="relative text-fg-soft">
                            <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-line bg-surface" />
                            <span className="acc mr-2 text-fg-muted">{new Date(e.createdAt).toLocaleTimeString()}</span>
                            {e.message}
                          </li>
                        ))}
                      </ol>
                    )}
                  </Card>
                  <ProvenancePanel calls={detail.providerCalls ?? []} />
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
