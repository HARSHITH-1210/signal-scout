"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RUN_STATUSES, STAGE_LABELS, TERMINAL_STATUSES, type RunStatus, type RunSummary } from "@/lib/types";
import { formatDateTime, formatMs, prospectDetail, prospectLabel, RUN_STATUS_LABEL, RUN_STATUS_TONE, signalTypeLabel } from "@/lib/ui/format";
import { Badge } from "./Badge";
import { Icon } from "./Icon";

type Filter = RunStatus | "all";

export function RunDashboard({ initialRuns }: { initialRuns: RunSummary[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();

  const active = runs.some((r) => !TERMINAL_STATUSES.includes(r.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/runs", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()).runs as RunSummary[];
        setRuns((prev) => {
          // Rows whose status moved hold a highlight so the change is noticed.
          const before = new Map(prev.map((r) => [r.id, r.status]));
          setChanged(new Set(next.filter((r) => before.has(r.id) && before.get(r.id) !== r.status).map((r) => r.id)));
          return next;
        });
        setLoadError(null);
      } catch {
        setLoadError("Couldn't refresh the run list. Retrying.");
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [active]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(RUN_STATUSES.map((s) => [s, 0])) as Record<RunStatus, number>;
    for (const r of runs) c[r.status]++;
    return c;
  }, [runs]);

  const visible = runs.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!query.trim()) return true;
    const hay = `${prospectLabel(r.prospect, r.resolvedLabel)} ${prospectDetail(r.prospect, r.resolvedLabel)}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const filters: Filter[] = ["all", ...RUN_STATUSES.filter((s) => counts[s] > 0)];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em]">Runs</h1>
          <p className="mt-1 text-fg-soft">Every prospect researched, what was verified, and where each draft stands.</p>
        </div>
        <Link href="/runs/new" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-strong">
          <Icon name="plus" />
          Research a prospect
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-6 py-16 text-center">
          <p className="text-lg font-bold">No prospects researched yet</p>
          <p className="mx-auto mt-2 max-w-md text-fg-soft">
            Start with whatever you know: a name, a company, a website, a LinkedIn profile, or drop in an account brief or a CSV of leads.
          </p>
          <Link href="/runs/new" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-strong">
            <Icon name="plus" />
            Research your first prospect
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`min-h-9 rounded-full border px-3 text-[13px] transition-colors ${
                    filter === f ? "border-obsidian bg-obsidian font-bold text-white" : "border-line bg-surface text-fg-soft hover:border-fg-muted/60"
                  }`}
                >
                  {f === "all" ? "All" : RUN_STATUS_LABEL[f]} <span className="acc opacity-80">{f === "all" ? runs.length : counts[f]}</span>
                </button>
              ))}
            </div>
            <label className="ml-auto min-w-[220px] flex-1 sm:max-w-xs">
              <span className="sr-only">Search runs</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or company"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-info focus:outline-none focus:ring-2 focus:ring-info/30"
              />
            </label>
          </div>
          {loadError && <p className="mt-3 text-sm text-warn">{loadError}</p>}

          <div className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line text-[13px] text-fg-muted">
                <tr>
                  <th className="px-4 py-3 font-bold">Prospect</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Hook</th>
                  <th className="px-4 py-3 text-right font-bold">Verified / sources</th>
                  <th className="px-4 py-3 text-right font-bold">Active</th>
                  <th className="px-4 py-3 font-bold">Started</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((run) => {
                  const running = !TERMINAL_STATUSES.includes(run.status);
                  const detail = prospectDetail(run.prospect, run.resolvedLabel);
                  return (
                    <tr
                      key={run.id}
                      onClick={() => router.push(`/runs/${run.id}`)}
                      className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-canvas/50 ${changed.has(run.id) ? "just-changed" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/runs/${run.id}`} onClick={(e) => e.stopPropagation()} className="font-bold text-fg hover:underline">
                          {prospectLabel(run.prospect, run.resolvedLabel)}
                        </Link>
                        <div className="flex items-center gap-2 text-[13px] text-fg-soft">
                          {detail}
                          {run.documentCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-fg-muted" title={`${run.documentCount} document(s) attached`}>
                              <Icon name="file" className="h-3.5 w-3.5" />
                              {run.documentCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={RUN_STATUS_TONE[run.status]} live={running}>
                          {RUN_STATUS_LABEL[run.status]}
                        </Badge>
                        {running && run.currentStage && <div className="mt-1 text-[12px] text-fg-muted">{STAGE_LABELS[run.currentStage]}</div>}
                        {run.status === "failed" && run.error && (
                          <div className="mt-1 max-w-[240px] truncate text-[12px] text-danger" title={run.error}>
                            {run.error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-fg-soft">
                        {run.hookType ? signalTypeLabel(run.hookType) : run.draftKind === "role_based" ? "Role-based draft" : <span className="text-fg-muted">None</span>}
                      </td>
                      <td className="acc px-4 py-3 text-right text-fg-soft">
                        {run.verifiedCount} / {run.sourceCount}
                      </td>
                      <td className="acc px-4 py-3 text-right text-fg-soft">{running ? "running" : run.activeMs > 0 ? formatMs(run.activeMs) : "n/a"}</td>
                      <td className="acc px-4 py-3 text-fg-muted">{formatDateTime(run.createdAt)}</td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-fg-soft">
                      No runs match. <button className="font-bold text-info hover:underline" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
