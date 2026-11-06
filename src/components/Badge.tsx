import type { Tone } from "@/lib/ui/format";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-subtle text-fg-soft",
};

export function Badge({ tone, children, live = false }: { tone: Tone; children: React.ReactNode; live?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE_CLASSES[tone]}`}>
      {live && (
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
