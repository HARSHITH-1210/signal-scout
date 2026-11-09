import { cn } from "@/lib/ui/cn";
import { Icon, type IconName } from "../Icon";

export function Card({ className, children, as: Tag = "section" }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" }) {
  return <Tag className={cn("rounded-[var(--radius-panel)] border border-line bg-surface", className)}>{children}</Tag>;
}

/** Page title block (Telemetry): a compact title, a mono context line, an optional sentence, actions on the right. */
export function PageHeader({ title, label, description, actions }: { title: string; label?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-fg">{title}</h1>
          {label && <p className="t-label mt-1.5">{label}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-3 max-w-[72ch] text-[14px] text-fg-muted">{description}</p>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon: IconName; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="grid h-11 w-11 place-items-center rounded-full border border-line text-fg-muted">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span aria-hidden className="t-volt-bg mt-4 h-[3px] w-8 rounded-full" />
      <p className="mt-4 text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}
