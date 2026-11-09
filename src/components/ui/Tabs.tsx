"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

/** Tabs in the Telemetry pill box (the navbar's Aurora box); the active pill slides with a shared layoutId. */
export function Tabs<T extends string>({ items, value, onChange, label, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const group = useId();
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = items[(index + step + items.length) % items.length];
    onChange(next.value);
    document.getElementById(`${group}-${next.value}`)?.focus();
  };
  return (
    <div className={cn("max-w-full overflow-x-auto [scrollbar-width:none]", className)}>
      <div role="tablist" aria-label={label} className="inline-flex gap-0.5 rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-1">
        {items.map((item, i) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              id={`${group}-${item.value}`}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn("relative flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors", active ? "text-fg" : "text-fg-muted hover:text-fg")}
            >
              {active && <motion.span layoutId={`${group}-pill`} transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-[var(--t-pill-active)]" />}
              <span className="relative">{item.label}</span>
              {item.count !== undefined && <span className="relative font-mono text-[10px] text-fg-muted">{item.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pill segmented control; the selected pill slides with a shared layoutId. */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  size = "md",
}: {
  items: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-0.5 backdrop-blur-[18px]">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
              size === "sm" ? "h-8 min-w-8 px-2 text-xs" : "h-8 px-3 text-[13px]",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && <motion.span layoutId={`${group}-pill`} transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-[var(--t-pill-active)]" />}
            <span className="relative flex items-center gap-1.5">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
