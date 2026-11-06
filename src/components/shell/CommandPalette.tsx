"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT, SPRING_SOFT, cn } from "@/lib/ui/cn";
import { prospectLabel, RUN_STATUS_LABEL } from "@/lib/ui/format";
import type { RunSummary } from "@/lib/types";
import { Icon, type IconName } from "../Icon";
import { Kbd } from "../ui/Button";
import { NAV_LINKS } from "./nav";

const OPEN_EVENT = "signal-scout:command-palette";

/** Open the palette from anywhere (the top bar search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  href?: string;
  theme?: string;
}

/** ⌘K palette: jump to a page or a recent run, start a run, switch theme. Navigation only; it never sends or approves. */
export function CommandPalette() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [open, show, close]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => input.current?.focus());
    let cancelled = false;
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { runs?: RunSummary[] } | null) => {
        if (!cancelled && body?.runs) setRuns(body.runs.slice(0, 8));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const commands = useMemo<Command[]>(
    () => [
      { id: "new", group: "Actions", label: "Start a new run", icon: "plus", hint: "Research a prospect", href: "/runs/new" },
      ...NAV_LINKS.filter((l) => l.href !== "/runs/new").map((l) => ({ id: l.href, group: "Go to", label: l.label, icon: l.icon, href: l.href })),
      ...runs.map((r) => ({ id: r.id, group: "Recent runs", label: prospectLabel(r.prospect, r.resolvedLabel), hint: RUN_STATUS_LABEL[r.status], icon: "runs" as IconName, href: `/runs/${r.id}` })),
      { id: "light", group: "Theme", label: "Light theme", icon: "spark", theme: "light" },
      { id: "dark", group: "Theme", label: "Dark theme", icon: "spark", theme: "dark" },
      { id: "system", group: "Theme", label: "Match system theme", icon: "spark", theme: "system" },
    ],
    [runs],
  );

  const run = (c: Command | undefined) => {
    if (!c) return;
    if (c.theme) setTheme(c.theme);
    close();
    if (c.href) router.push(c.href);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.label} ${c.group} ${c.hint ?? ""}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] dark:bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE_OUT }} onClick={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-overlay)]"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
            transition={SPRING_SOFT}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="search" className="h-4 w-4 text-fg-muted" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
                placeholder="Search pages, runs and actions…"
                className="h-14 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
              />
              <Kbd>esc</Kbd>
            </div>
            <ul ref={list} id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {filtered.length === 0 && <li className="px-3 py-8 text-center text-sm text-fg-muted">No matches.</li>}
              {filtered.map((c, i) => {
                const header = i === 0 || filtered[i - 1].group !== c.group ? c.group : null;
                return (
                  <li key={c.id} role="presentation">
                    {header && <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-fg-muted first:pt-1">{header}</p>}
                    <div
                      id={`cmd-${c.id}`}
                      role="option"
                      aria-selected={i === active}
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(c)}
                      className={cn("relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm", i === active ? "text-fg" : "text-fg-soft")}
                    >
                      {i === active && <motion.span layoutId="cmd-active" transition={{ type: "spring", stiffness: 600, damping: 40 }} className="absolute inset-0 rounded-lg bg-subtle" />}
                      <Icon name={c.icon} className="relative h-4 w-4 text-fg-muted" />
                      <span className="relative flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="relative text-xs text-fg-muted">{c.hint}</span>}
                      {i === active && <Icon name="arrowRight" className="relative h-3.5 w-3.5 text-fg-muted" />}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-fg-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
