"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "motion/react";
import { EASE_OUT, RISE_IN, cn } from "@/lib/ui/cn";
import { Icon } from "../Icon";

/** Children rise in one after another (50ms stagger). */
export function Stagger({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0, y: 8, filter: "blur(4px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.3, ease: EASE_OUT } } }}
    >
      {children}
    </motion.div>
  );
}

export function RiseIn({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} {...RISE_IN} transition={{ ...RISE_IN.transition, delay }}>
      {children}
    </motion.div>
  );
}

/** Counts up to `value` the first time it scrolls into view. */
export function NumberTicker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, { duration: 0.9, ease: EASE_OUT, onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {(reduce ? value : shown).toLocaleString()}
    </span>
  );
}

/** A card whose background follows the cursor with a soft accent glow. */
export function SpotlightCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
  };
  return (
    <div onMouseMove={onMove} className={cn("spotlight rounded-[var(--radius-panel)] border border-line bg-surface transition-colors hover:border-fg-muted/30", className)}>
      {children}
    </div>
  );
}

/** Disclosure with an animated height. Replaces <details> where motion helps scanning. */
export function Collapsible({ title, children, defaultOpen = false, aside, className }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="group flex min-h-10 w-full items-center gap-2 text-left text-sm font-medium text-fg">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="text-fg-muted group-hover:text-fg">
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </motion.span>
        <span className="flex-1">{title}</span>
        {aside}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="pb-2 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function relative(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  if (Math.abs(diff) < 45_000) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  return "";
}

const noopSubscribe = () => () => undefined;

/** True after hydration; false during server render. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const TICK_MS = 30_000;
function subscribeClock(onTick: () => void) {
  const t = window.setInterval(onTick, TICK_MS);
  return () => window.clearInterval(t);
}

/** "3 min ago", ticking every 30s; the absolute time is in the tooltip. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => null,
  );
  const absolute = new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <time dateTime={iso} title={absolute} className={className}>
      {now === null ? absolute : relative(iso, now)}
    </time>
  );
}
