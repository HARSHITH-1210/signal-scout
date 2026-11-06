"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_SOFT, cn } from "@/lib/ui/cn";

/**
 * Anchored popover: the trigger toggles it, outside click or Escape closes it, and focus returns
 * to the trigger on Escape. `trigger` receives the open state for styling.
 */
export function Popover({
  trigger,
  label,
  children,
  className,
  triggerClassName,
  disabled,
}: {
  trigger: (open: boolean) => React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
  triggerClassName?: (open: boolean) => string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName?.(open)}
      >
        {trigger(open)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={SPRING_SOFT}
            style={{ transformOrigin: "top left" }}
            className={cn("absolute left-0 z-30 mt-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]", className)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
