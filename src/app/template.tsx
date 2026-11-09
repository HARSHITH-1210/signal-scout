"use client";

import { motion } from "motion/react";
import { EASE_OUT } from "@/lib/ui/cn";

/** Remounts on every navigation: each page rises in. Enter-only, since App Router exits are unreliable. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}
