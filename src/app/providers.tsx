"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { ConfirmProvider } from "@/components/ui/Dialog";
import { ToastProvider } from "@/components/ui/Toast";
import { CommandPalette } from "@/components/shell/CommandPalette";

/** Client providers: theme (class on <html>), motion that respects reduced-motion, toasts, confirmations, ⌘K. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <ConfirmProvider>
            {children}
            <CommandPalette />
          </ConfirmProvider>
        </ToastProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
