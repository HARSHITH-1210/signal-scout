import type { Tone } from "@/lib/ui/format";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-subtle text-fg-muted",
};

/** Status pill in the Telemetry style: a dot and a mono uppercase word. The dot pulses only for live work. */
export function Badge({ tone, children, live = false }: { tone: Tone; children: React.ReactNode; live?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${TONE_CLASSES[tone]}`}>
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {children}
    </span>
  );
}
