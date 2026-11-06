"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_SOFT } from "@/lib/ui/cn";
import { Icon, type IconName } from "../Icon";

type ToastTone = "ok" | "bad" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const ICON: Record<ToastTone, IconName> = { ok: "check", bad: "alert", info: "check" };
const TONE: Record<ToastTone, string> = { ok: "text-ok bg-ok-soft", bad: "text-danger bg-danger-soft", info: "text-info bg-info-soft" };

type ToastFn = (toast: Omit<ToastItem, "id">) => void;
const ToastContext = createContext<ToastFn | null>(null);

/** Show a short confirmation (saved, copied, sent) or an error. */
export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error("useToast must be used inside ToastProvider");
  return fn;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback<ToastFn>(
    (t) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === "bad" ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
              transition={SPRING_SOFT}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3 pr-2 shadow-[var(--shadow-overlay)]"
            >
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${TONE[t.tone]}`}>
                <Icon name={ICON[t.tone]} className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-fg-muted">{t.description}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg">
                <Icon name="cross" className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
