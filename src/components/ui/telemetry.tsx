import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";
import { InfoTip } from "./Tooltip";

/** Telemetry direction: pill buttons. Primary inverts the page (light pill on dark, dark pill with lime on light). */
export const T_PILL =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-[transform,opacity,border-color,background-color] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";
export const T_PILL_PRIMARY = cn(T_PILL, "bg-[var(--t-inv-bg)] text-[var(--t-inv-btn)] font-semibold");
export const T_PILL_GHOST = cn(T_PILL, "border border-[var(--t-line)] bg-[var(--t-card)] text-[var(--t-fg)] hover:border-[var(--t-muted)]");

const control = (error?: string) =>
  cn(
    "mt-2 block w-full rounded-xl border bg-[var(--t-card)] px-3.5 py-2.5 text-[14px] text-[var(--t-fg)] placeholder:text-[var(--t-dim)] transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-4",
    error ? "border-[var(--t-bad)] focus:ring-[color-mix(in_oklab,var(--t-bad)_18%,transparent)]" : "border-[var(--t-line)] hover:border-[var(--t-muted)] focus:border-[var(--t-info)] focus:ring-[color-mix(in_oklab,var(--t-info)_18%,transparent)]",
  );

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  /** Extra context shown in a tooltip next to the label instead of a line under the field. */
  tip?: React.ReactNode;
}

/** Field wrapper: the label and its optional info tip sit above the control; the tip button stays outside the <label>. */
function FieldShell({ label, name, tip, children }: { label: string; name: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span className="flex items-center gap-1.5">
        <label htmlFor={`f-${name}`} className="t-label">
          {label}
        </label>
        {tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}
      </span>
      {children}
    </div>
  );
}

function Note({ name, hint, error }: { name: string; hint?: string; error?: string }) {
  if (error)
    return (
      <span id={`${name}-error`} className="t-mono mt-1.5 block text-[11px] text-[var(--t-bad)]">
        {error}
      </span>
    );
  if (hint)
    return (
      <span id={`${name}-hint`} className="mt-1.5 block text-[12px] text-[var(--t-muted)]">
        {hint}
      </span>
    );
  return null;
}

/** Text input with a mono uppercase label, in the Telemetry direction. */
export function TField({ label, name, hint, error, tip, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} name={name} tip={tip}>
      <input id={`f-${name}`} name={name} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined} className={control(error)} {...rest} />
      <Note name={name} hint={hint} error={error} />
    </FieldShell>
  );
}

export function TTextArea({ label, name, hint, error, tip, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} name={name} tip={tip}>
      <textarea id={`f-${name}`} name={name} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined} className={control(error)} {...rest} />
      <Note name={name} hint={hint} error={error} />
    </FieldShell>
  );
}

/** Numbered section heading: "02 · The person". Any explanation goes in an info tip, not a paragraph. */
export function TSection({ step, title, children, id }: { step: string; title: string; children?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <h2 id={id} className="flex items-baseline gap-3 text-[15px] font-semibold tracking-[-0.01em]">
        <span className="t-mono text-[11px] font-normal text-[var(--t-muted)]">{step}</span>
        {title}
      </h2>
      {children && (
        <InfoTip label={`About ${title}`} align="start">
          {children}
        </InfoTip>
      )}
    </div>
  );
}
