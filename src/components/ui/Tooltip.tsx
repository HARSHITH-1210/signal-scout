"use client";

import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/ui/cn";

const GAP = 8;
const MARGIN = 12;

/**
 * Hover and focus tooltip, rendered in a portal with fixed positioning so scroll containers and
 * rounded cards can't clip it; it's clamped to the viewport. The wrapper takes the hover, so it
 * also works on disabled buttons (which swallow pointer events). The child gets aria-describedby.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
  className?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = align === "start" ? a.left : align === "end" ? a.right - t.width : a.left + a.width / 2 - t.width / 2;
    left = Math.max(MARGIN, Math.min(left, vw - t.width - MARGIN));
    // Flip when there isn't room on the preferred side.
    const below = side === "bottom" ? a.bottom + GAP + t.height < window.innerHeight : a.top - GAP - t.height < 0;
    const top = below ? a.bottom + GAP : a.top - GAP - t.height;
    setPos({ left, top, below });
  }, [open, side, align]);

  if (!content) return children;
  const child = isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children;
  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span ref={anchor} className={cn("relative inline-flex", className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {child}
      {/* Kept in the DOM for aria-describedby; the visible bubble is the portal below. */}
      <span id={id} className="sr-only">
        {content}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={tip}
                aria-hidden="true"
                initial={{ opacity: 0, y: side === "top" ? 4 : -4 }}
                animate={{ opacity: pos ? 1 : 0, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15 }}
                style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
                className="pointer-events-none fixed z-[90] w-max max-w-[260px] rounded-lg bg-[var(--t-inv-bg)] px-2.5 py-1.5 text-left font-sans text-[12px] font-normal normal-case leading-snug tracking-normal text-[var(--t-inv-fg)] shadow-[var(--shadow-overlay)]"
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}

/** A small "i" that explains a heading or field on hover or focus, instead of a sentence on the page. */
export function InfoTip({ children, label = "More info", side = "top", align = "center" }: { children: React.ReactNode; label?: string; side?: "top" | "bottom"; align?: "center" | "start" | "end" }) {
  return (
    <Tooltip content={children} side={side} align={align}>
      <button
        type="button"
        aria-label={label}
        className="inline-grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full border border-current/30 align-middle font-mono text-[9px] leading-none text-fg-muted transition-colors hover:text-fg focus-visible:text-fg"
      >
        i
      </button>
    </Tooltip>
  );
}
