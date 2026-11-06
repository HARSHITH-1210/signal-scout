"use client";

import { STAGE_LABELS, STAGES, type RunEvent, type RunStatus, type StageName, type StageStatus } from "@/lib/types";
import { formatDuration } from "@/lib/ui/format";

const ROW = 68; // px per stage row
const CX = 20; // spine x
const R = 11; // node radius

/** What each stage does, shown before a run starts (and as a fallback sublabel). */
const STAGE_HINTS: Record<StageName, string> = {
  validate: "Checks the details and any attached files",
  resolve_identity: "Confirms who the prospect is",
  research: "News, funding, hiring, interviews, priorities",
  extract_signals: "Proposes findings, each with a quote",
  verify: "Every quote matched word for word",
  rank_hook: "Relevance, freshness, source quality",
  draft: "Structured email built on the hook",
  guard: "Each claim checked against its quote",
};

const NODE: Record<StageStatus, { fill: string; stroke: string; glyph: "num" | "check" | "alert" | "cross" | "dash" | "dot" }> = {
  pending: { fill: "var(--color-paper)", stroke: "var(--color-rule)", glyph: "num" },
  running: { fill: "var(--color-paper)", stroke: "var(--color-det)", glyph: "dot" },
  succeeded: { fill: "var(--color-ok)", stroke: "var(--color-ok)", glyph: "check" },
  warning: { fill: "var(--color-ochre)", stroke: "var(--color-ochre)", glyph: "alert" },
  failed: { fill: "var(--color-specimen)", stroke: "var(--color-specimen)", glyph: "cross" },
  skipped: { fill: "var(--color-board)", stroke: "var(--color-rule)", glyph: "dash" },
};

const STATUS_WORD: Record<StageStatus, string> = {
  pending: "waiting",
  running: "in progress",
  succeeded: "done",
  warning: "done, with notes",
  failed: "failed",
  skipped: "skipped",
};

function Glyph({ kind, x, y, n }: { kind: (typeof NODE)[StageStatus]["glyph"]; x: number; y: number; n: number }) {
  const stroke = { stroke: "white", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (kind) {
    case "check":
      return <path d={`M${x - 4.5} ${y + 0.5}l3 3 6-6.5`} {...stroke} />;
    case "alert":
      return <path d={`M${x} ${y - 4.5}v5M${x} ${y + 4}v.01`} {...stroke} />;
    case "cross":
      return <path d={`M${x - 3.5} ${y - 3.5}l7 7M${x + 3.5} ${y - 3.5}l-7 7`} {...stroke} />;
    case "dash":
      return <path d={`M${x - 4} ${y}h8`} stroke="var(--color-muted)" strokeWidth={2} strokeLinecap="round" />;
    case "dot":
      return <circle cx={x} cy={y} r={4} fill="var(--color-det)" />;
    default:
      return (
        <text x={x} y={y + 4} textAnchor="middle" className="acc" fontSize={11} fill="var(--color-muted)">
          {n}
        </text>
      );
  }
}

const done = (s: StageStatus) => s === "succeeded" || s === "warning";

/**
 * The accession ledger: the run's stages as a vertical line that fills in as each completes, with the two
 * exits (clarification, not enough signal) drawn as side tabs that light up only when taken.
 * The SVG is decorative; the ordered list and the status line carry the same information as text.
 */
export function PipelineDiagram({
  statuses,
  events,
  runStatus,
  preview = false,
}: {
  statuses: Record<StageName, StageStatus>;
  events: RunEvent[];
  runStatus?: RunStatus;
  preview?: boolean;
}) {
  // A stage "just changed" when its latest event is among the run's two most recent: derived, not tracked.
  const recentIds = new Set(events.slice(-2).map((e) => e.id));
  const changed = new Set(STAGES.filter((s) => events.some((e) => e.stage === s && recentIds.has(e.id) && e.status !== "running")));

  const height = STAGES.length * ROW;
  const runningIndex = STAGES.findIndex((s) => statuses[s] === "running");
  const lastDone = STAGES.reduce((acc, s, i) => (done(statuses[s]) ? i : acc), -1);
  const current = runningIndex >= 0 ? runningIndex : lastDone;
  const exitClarify = runStatus === "needs_clarification";
  const exitInsufficient = runStatus === "insufficient_research";
  const exitAt = exitClarify ? 1 : exitInsufficient ? (statuses.rank_hook === "warning" ? 5 : 1) : -1;

  const latest = (stage: StageName) => [...events].reverse().find((e) => e.stage === stage);
  const duration = (stage: StageName) => {
    const evs = events.filter((e) => e.stage === stage);
    const start = evs.find((e) => e.status === "running");
    const end = [...evs].reverse().find((e) => e.status !== "running");
    return start && end && done(end.status) ? formatDuration(start.createdAt, end.createdAt) : null;
  };

  const summary = preview
    ? "Eight stages, from checking details to auditing the draft."
    : runningIndex >= 0
      ? `Stage ${runningIndex + 1} of ${STAGES.length}: ${STAGE_LABELS[STAGES[runningIndex]]}. ${latest(STAGES[runningIndex])?.message ?? ""}`
      : exitClarify
        ? "Paused at identity: waiting for you to pick the right match."
        : exitInsufficient
          ? "Stopped: not enough verified signal for a personalised hook."
          : runStatus === "failed"
            ? `Stopped with an error at ${STAGE_LABELS[STAGES.find((s) => statuses[s] === "failed") ?? "validate"]}.`
            : lastDone === STAGES.length - 1
              ? "All eight stages complete."
              : "Waiting to start.";

  return (
    <div>
      <p role="status" aria-atomic="true" className="mb-4 rounded-lg bg-canvas px-3 py-2 text-sm text-fg-soft">
        {summary}
      </p>
      <div className="relative" style={{ minHeight: height }}>
        <svg aria-hidden="true" width={CX * 2 + 4} height={height} viewBox={`0 0 ${CX * 2 + 4} ${height}`} className="absolute top-0 left-0">
          {/* Spine segments, drawn before nodes so they sit behind them. */}
          {STAGES.slice(0, -1).map((stage, i) => {
            const y1 = i * ROW + 22 + R;
            const y2 = (i + 1) * ROW + 22 - R;
            const filled = done(statuses[stage]) && statuses[STAGES[i + 1]] !== "skipped";
            const flowing = filled && statuses[STAGES[i + 1]] === "running";
            return (
              <line
                key={stage}
                x1={CX}
                x2={CX}
                y1={y1}
                y2={y2}
                stroke={filled ? "var(--color-rail)" : "var(--color-rule)"}
                strokeWidth={filled ? 2.5 : 2}
                strokeDasharray={filled && !flowing ? undefined : "4 4"}
                className={flowing ? "flow" : undefined}
              />
            );
          })}
          {STAGES.map((stage, i) => {
            const status = statuses[stage];
            const y = i * ROW + 22;
            const node = NODE[status];
            const isCurrent = i === current && !preview;
            return (
              <g key={stage} className={changed.has(stage) && !preview ? "stamp-in" : undefined}>
                {status === "running" && <circle cx={CX} cy={y} r={13} fill="none" stroke="var(--color-det)" strokeWidth={2} className="pulse-ring" />}
                <circle cx={CX} cy={y} r={R} fill={node.fill} stroke={node.stroke} strokeWidth={isCurrent ? 2.5 : 1.5} strokeDasharray={status === "skipped" ? "3 3" : undefined} />
                <Glyph kind={node.glyph} x={CX} y={y} n={i + 1} />
              </g>
            );
          })}
        </svg>

        <ol className="relative" aria-label="Pipeline stages">
          {STAGES.map((stage, i) => {
            const status = statuses[stage];
            const last = latest(stage);
            const time = preview ? null : duration(stage);
            const muted = status === "pending" || status === "skipped";
            const showExit = (i === 1 || i === 5) && (preview || exitAt === i || status !== "skipped");
            const exitTaken = exitAt === i;
            return (
              <li
                key={stage}
                className={`flex flex-col justify-start pl-[54px] ${changed.has(stage) && !preview ? "just-changed rounded-md" : ""}`}
                style={{ height: ROW }}
              >
                <div className="flex items-baseline justify-between gap-2 pt-[11px]">
                  <span className={`text-[14px] font-bold leading-tight ${muted ? "text-fg-muted" : "text-fg"}`}>
                    {STAGE_LABELS[stage]}
                    <span className="sr-only">: {STATUS_WORD[status]}</span>
                  </span>
                  {time && <span className="acc shrink-0 text-fg-muted">{time}</span>}
                </div>
                <p className={`mt-0.5 line-clamp-1 text-[13px] leading-snug ${status === "failed" ? "text-danger" : "text-fg-muted"}`} title={last?.message}>
                  {preview || !last ? STAGE_HINTS[stage] : last.message}
                </p>
                {showExit && (preview || exitTaken) && (
                  <span
                    className={`mt-1 inline-flex w-fit items-center gap-1.5 rounded px-1.5 py-px text-[11px] font-bold ${
                      exitTaken ? "bg-warn-soft text-warn" : "border border-dashed border-line text-fg-muted"
                    }`}
                  >
                    <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10">
                      <path d="M1 1v3a4 4 0 0 0 4 4h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    {i === 1 ? (exitTaken && exitClarify ? "Paused: needs clarification" : exitTaken ? "Stopped: identity not confirmed" : "Exit: needs clarification") : exitTaken ? "Stopped: not enough signal" : "Exit: not enough signal"}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
