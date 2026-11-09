import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "btn-obsidian",
  secondary: "border border-line bg-surface text-fg hover:border-fg-muted",
  ghost: "text-fg-soft hover:bg-subtle hover:text-fg",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3.5 text-[13px]",
  md: "min-h-10 px-4 text-[13px]",
};

/** Class string for any element styled as a button (links included). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("animate-spin motion-reduce:animate-none", className)}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", loading = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-current/25 px-1 font-mono text-[10px] font-medium opacity-70",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
