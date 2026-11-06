"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

/** Underlined tabs; the indicator slides between tabs with a shared layoutId. */
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
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
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
            className={cn("relative flex min-h-10 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium transition-colors", active ? "text-fg" : "text-fg-muted hover:text-fg")}
          >
            {item.label}
            {item.count !== undefined && <span className={cn("acc rounded-full px-1.5 text-[11px]", active ? "bg-obsidian text-obsidian-ink" : "bg-subtle text-fg-muted")}>{item.count}</span>}
            {active && <motion.span layoutId={`${group}-underline`} transition={SPRING_SNAPPY} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-obsidian" />}
          </button>
        );
      })}
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
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
              "relative flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "h-7 min-w-7 px-1.5 text-xs" : "h-8 px-3 text-[13px]",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && <motion.span layoutId={`${group}-pill`} transition={SPRING_SNAPPY} className="absolute inset-0 rounded-md border border-line bg-surface shadow-sm" />}
            <span className="relative flex items-center gap-1.5">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
