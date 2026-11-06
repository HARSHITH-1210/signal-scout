"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { Icon } from "../Icon";
import { useToast } from "./Toast";

/** Copy text to the clipboard; the icon morphs to a check and a toast confirms. */
export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      toast({ tone: "ok", title: "Copied to clipboard" });
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast({ tone: "bad", title: "Couldn't copy", description: "Your browser blocked clipboard access." });
    }
  }
  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className={cn("grid h-7 w-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-subtle hover:text-fg", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={done ? "done" : "copy"} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
          <Icon name={done ? "check" : "copy"} className={cn("h-3.5 w-3.5", done && "text-ok")} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
