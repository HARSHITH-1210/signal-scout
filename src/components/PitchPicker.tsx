"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Sector } from "@/lib/types";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Icon } from "./Icon";
import { Popover } from "./ui/Popover";

export interface PitchSelection {
  auto: boolean;
  offeringIds: string[];
}

/** Must match MAX_CHOSEN_OFFERINGS on the server (src/lib/pipeline/pitch.ts). */
const MAX_CHOSEN = 5;
const STORAGE_KEY = "signal-scout:pitch";

/** The rep's last choice, kept per browser as a convenience; ids that no longer exist are dropped. */
function loadSaved(sectors: Sector[]): PitchSelection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<PitchSelection>;
    const known = new Set(sectors.flatMap((s) => s.offerings.map((o) => o.id)));
    return { auto: saved.auto === true, offeringIds: (saved.offeringIds ?? []).filter((id) => known.has(id)).slice(0, MAX_CHOSEN) };
  } catch {
    return null;
  }
}

function save(selection: PitchSelection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private windows can block storage; the choice just isn't remembered.
  }
}

/** One popover per sector; tick one or more offerings across sectors, or let research choose. */
export function PitchPicker({ sectors, value, onChange, error }: { sectors: Sector[]; value: PitchSelection; onChange: (v: PitchSelection) => void; error?: string }) {
  // Restored once after mount: the server render can't see this browser's storage.
  const restored = useRef(false);
  const offerings = sectors.flatMap((s) => s.offerings.map((o) => ({ ...o, sectorName: s.name })));

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = loadSaved(sectors);
    if (saved && (saved.auto || saved.offeringIds.length)) onChange(saved);
  }, [sectors, onChange]);

  const update = (next: PitchSelection) => {
    onChange(next);
    save(next);
  };
  const toggle = (id: string) => {
    const has = value.offeringIds.includes(id);
    if (!has && value.offeringIds.length >= MAX_CHOSEN) return;
    update({ auto: false, offeringIds: has ? value.offeringIds.filter((x) => x !== id) : [...value.offeringIds, id] });
  };

  if (offerings.length === 0)
    return (
      <p className="t-mono text-[12px] text-[var(--t-warn)]">
        No offerings set up, so drafts stay general.{" "}
        <Link href="/settings" className="font-medium underline">
          Add what you sell
        </Link>
      </p>
    );

  const chosen = offerings.filter((o) => value.offeringIds.includes(o.id));
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {sectors
          .filter((s) => s.offerings.length > 0)
          .map((sector) => {
            const picked = sector.offerings.filter((o) => value.offeringIds.includes(o.id)).length;
            const on = picked > 0 && !value.auto;
            return (
              <Popover
                key={sector.id}
                label={`${sector.name} offerings`}
                disabled={value.auto}
                className="w-[min(340px,calc(100vw-48px))]"
                triggerClassName={(open) =>
                  cn(
                    "flex min-h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors disabled:opacity-45",
                    on ? "border-[var(--t-muted)] bg-[var(--t-pill-active)] text-[var(--t-fg)]" : "border-[var(--t-line)] bg-[var(--t-card)] text-[var(--t-soft)] hover:border-[var(--t-muted)]",
                    open && "border-[var(--t-info)]",
                  )
                }
                trigger={(open) => (
                  <>
                    {sector.name}
                    {on && <span className="t-mono rounded-full bg-[var(--t-inv-bg)] px-1.5 text-[10px] text-[var(--t-inv-btn)]">{picked}</span>}
                    <Icon name="chevron" className={cn("h-3.5 w-3.5 transition-transform duration-200", open ? "-rotate-90" : "rotate-90")} />
                  </>
                )}
              >
                <fieldset disabled={value.auto}>
                  <legend className="sr-only">{sector.name} offerings</legend>
                  {sector.offerings.map((o) => {
                    const checked = value.offeringIds.includes(o.id);
                    const full = !checked && value.offeringIds.length >= MAX_CHOSEN;
                    return (
                      <label key={o.id} className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--t-pill-hover)]", full && "opacity-45")}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} disabled={full} onChange={() => toggle(o.id)} />
                        <span className="text-sm">
                          <span className="font-medium">{o.name}</span>
                          {o.whatItDoes && <span className="mt-0.5 line-clamp-2 block text-[12px] text-[var(--t-muted)]">{o.whatItDoes}</span>}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              </Popover>
            );
          })}
      </div>

      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <span className="relative mt-0.5 inline-flex shrink-0">
          <input type="checkbox" role="switch" className="peer sr-only" checked={value.auto} onChange={(e) => update({ auto: e.target.checked, offeringIds: value.offeringIds })} />
          <span className="h-5 w-9 rounded-full border border-[var(--t-line)] bg-[var(--t-pill-box)] transition-colors peer-checked:border-transparent peer-checked:bg-[image:var(--t-volt)] peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--t-fg)] shadow-sm peer-checked:bg-[var(--t-inv-btn)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] peer-checked:translate-x-4" />
        </span>
        <span>
          <span className="font-medium">Let Signal Scout choose</span>
          <span className="block text-[12px] text-[var(--t-muted)]">Consider every offering and lead with whichever the research supports best.</span>
        </span>
      </label>

      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen offerings">
        <AnimatePresence initial={false}>
          {!value.auto &&
            chosen.map((o) => (
              <motion.li
                key={o.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
                transition={SPRING_SNAPPY}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--t-line)] bg-[var(--t-card)] py-0.5 pr-0.5 pl-3 text-[13px]"
              >
                <span className="t-mono text-[11px] uppercase tracking-[0.08em] text-[var(--t-muted)]">{o.sectorName} ·</span> {o.name}
                <button type="button" onClick={() => toggle(o.id)} aria-label={`Remove ${o.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-danger">
                  <Icon name="cross" className="h-3.5 w-3.5" />
                </button>
              </motion.li>
            ))}
        </AnimatePresence>
      </ul>
      <p className={`t-mono mt-3 text-[11px] ${error ? "text-[var(--t-bad)]" : "text-[var(--t-muted)]"}`} role={error ? "alert" : undefined}>
        {error ??
          (value.auto
            ? "Every offering is considered."
            : chosen.length === 0
              ? `Choose one or more (up to ${MAX_CHOSEN}).`
              : chosen.length === 1
                ? "The email pitches this one."
                : "The email leads with the best fit for the research and names the others in passing.")}
      </p>
    </div>
  );
}
