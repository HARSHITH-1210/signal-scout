"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { STAGE_LABELS, TERMINAL_STATUSES, type RunStatus, type RunSummary } from "@/lib/types";
import { formatMs, prospectDetail, prospectLabel, RUN_STATUS_LABEL, RUN_STATUS_TONE, signalTypeLabel } from "@/lib/ui/format";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { buttonClass } from "./ui/Button";
import { EmptyState, PageHeader } from "./ui/Card";
import { RelativeTime } from "./ui/Motion";
import { Tabs } from "./ui/Tabs";

type View = "all" | "review" | "active" | "approved" | "sent" | "stopped";

const VIEWS: { value: View; label: string; statuses: RunStatus[] | null }[] = [
  { value: "all", label: "All", statuses: null },
  { value: "review", label: "Needs you", statuses: ["awaiting_review", "needs_clarification", "held"] },
  { value: "active", label: "In progress", statuses: ["queued", "running"] },
  { value: "approved", label: "Approved", statuses: ["approved"] },
  { value: "sent", label: "Sent", statuses: ["sent"] },
  { value: "stopped", label: "Didn't finish", statuses: ["failed", "insufficient_research", "stopped"] },
];

function inView(view: View, status: RunStatus): boolean {
  const statuses = VIEWS.find((v) => v.value === view)?.statuses;
  return !statuses || statuses.includes(status);
}

const COLS = "md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(150px,1fr)_minmax(0,1fr)_90px_80px_100px] md:items-center md:gap-4";

export function RunDashboard({ initialRuns }: { initialRuns: RunSummary[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (VIEWS.some((v) => v.value === params.get("view")) ? params.get("view") : "all") as View;
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const setView = (next: View) => {
    const q = new URLSearchParams(params);
    if (next === "all") q.delete("view");
    else q.set("view", next);
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  };

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

  // "/" jumps to search, like most list views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.value, runs.filter((r) => inView(v.value, r.status)).length])) as Record<View, number>, [runs]);

  const visible = runs.filter((r) => {
    if (!inView(view, r.status)) return false;
    if (!query.trim()) return true;
    const hay = `${prospectLabel(r.prospect, r.resolvedLabel)} ${prospectDetail(r.prospect, r.resolvedLabel)}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  // Arrow keys move between rows; Enter follows the focused row's link.
  const onRowKey = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-row]") ?? [])];
    const i = rows.indexOf(e.currentTarget);
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <div>
      <PageHeader
        title="Runs"
        label={`${runs.length} ${runs.length === 1 ? "run" : "runs"} · ${counts.active} in progress · ${counts.review} need you`}
        actions={
          <Link href="/runs/new" className={buttonClass("primary")}>
            <Icon name="plus" />
            Research a prospect
          </Link>
        }
      />

      {runs.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface">
          <EmptyState
            icon="search"
            title="No prospects researched yet"
            className="py-16"
            action={
              <Link href="/runs/new" className={buttonClass("primary")}>
                <Icon name="plus" />
                Research your first prospect
              </Link>
            }
          >
            A name, a company or a file is enough.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Tabs label="Filter runs" items={VIEWS.filter((v) => v.value === "all" || counts[v.value] > 0).map((v) => ({ value: v.value, label: v.label, count: counts[v.value] }))} value={view} onChange={setView} className="min-w-0 flex-1 border-b-0" />
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search runs</span>
              <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-10 text-[13px] transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
              />
            </label>
          </div>
          {loadError && (
            <p role="status" className="mt-3 text-sm text-warn">
              {loadError}
            </p>
          )}

          <div className="mt-3 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            <div aria-hidden className={cn("t-label hidden border-b border-line px-5 py-3", COLS)}>
              <span>Prospect</span>
              <span>Status</span>
              <span>Hook</span>
              <span className="text-right">Verified</span>
              <span className="text-right">Active</span>
              <span className="text-right">Started</span>
            </div>
            <ul ref={list} aria-label="Runs" className="divide-y divide-line-soft">
              <AnimatePresence initial={false} mode="popLayout">
                {visible.map((run) => {
                  const running = !TERMINAL_STATUSES.includes(run.status);
                  const detail = prospectDetail(run.prospect, run.resolvedLabel);
                  return (
                    <motion.li key={run.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
                      <Link
                        href={`/runs/${run.id}`}
                        data-row
                        onKeyDown={onRowKey}
                        className={cn("group relative grid gap-2 px-5 py-3.5 transition-colors hover:bg-subtle/60 focus-visible:rounded-none focus-visible:bg-subtle/60", COLS, changed.has(run.id) && "just-changed")}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{prospectLabel(run.prospect, run.resolvedLabel)}</span>
                          <span className="flex items-center gap-2 truncate text-[13px] text-fg-muted">
                            {detail}
                            {run.documentCount > 0 && (
                              <span className="inline-flex items-center gap-1" title={`${run.documentCount} document(s) attached`}>
                                <Icon name="file" className="h-3.5 w-3.5" />
                                {run.documentCount}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge tone={RUN_STATUS_TONE[run.status]} live={running}>
                            {RUN_STATUS_LABEL[run.status]}
                          </Badge>
                          {running && run.currentStage && <span className="text-[12px] text-fg-muted">{STAGE_LABELS[run.currentStage]}</span>}
                          {run.status === "failed" && run.error && (
                            <span className="block max-w-[240px] truncate text-[12px] text-danger" title={run.error}>
                              {run.error}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[13px] text-fg-soft">
                          <span className="text-fg-muted md:hidden">Hook: </span>
                          {run.hookType ? signalTypeLabel(run.hookType) : run.draftKind === "role_based" ? "Role-based draft" : <span className="text-fg-muted">None</span>}
                        </span>
                        <span className="acc text-fg-soft md:text-right">
                          {run.verifiedCount}/{run.sourceCount}
                          <span className="font-sans text-fg-muted md:hidden"> verified / sources</span>
                        </span>
                        <span className="acc hidden text-right text-fg-soft md:block">{running ? "running" : run.activeMs > 0 ? formatMs(run.activeMs) : "n/a"}</span>
                        <RelativeTime iso={run.createdAt} className="acc text-fg-muted md:text-right" />
                      </Link>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            {visible.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-fg-muted">
                No runs match.{" "}
                <button
                  type="button"
                  className="font-medium text-fg underline"
                  onClick={() => {
                    setView("all");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
