import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}

const control = (error?: string) =>
  `mt-2 block w-full rounded-xl border bg-surface px-3.5 py-2.5 text-[14px] text-fg placeholder:text-fg-muted/60 transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-4 focus:ring-accent/15 ${
    error ? "border-danger" : "border-line hover:border-fg-muted focus:border-accent"
  }`;

function Message({ name, hint, error }: { name: string; hint?: string; error?: string }) {
  if (error)
    return (
      <span id={`${name}-error`} className="t-mono mt-1.5 block text-[11px] text-danger">
        {error}
      </span>
    );
  if (hint)
    return (
      <span id={`${name}-hint`} className="mt-1.5 block text-[12px] text-fg-muted">
        {hint}
      </span>
    );
  return null;
}

export function TextField({ label, name, hint, error, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <span className="t-label">{label}</span>
      <input
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={control(error)}
        {...rest}
      />
      <Message name={name} hint={hint} error={error} />
    </label>
  );
}

export function TextArea({ label, name, hint, error, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block text-sm">
      <span className="t-label">{label}</span>
      <textarea
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={control(error)}
        {...rest}
      />
      <Message name={name} hint={hint} error={error} />
    </label>
  );
}

/** A bordered surface panel: the one container in the system. */
export function Panel({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius-panel)] border border-line bg-surface p-5 sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="t-label">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
