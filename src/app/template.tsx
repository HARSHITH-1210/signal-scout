"use client";

import { motion } from "motion/react";
import { EASE_OUT } from "@/lib/ui/cn";

/** Remounts on every navigation: each page rises in. Enter-only, since App Router exits are unreliable. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.35, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}
