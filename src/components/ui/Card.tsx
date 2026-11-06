import { cn } from "@/lib/ui/cn";
import { Icon, type IconName } from "../Icon";

export function Card({ className, children, as: Tag = "section" }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" }) {
  return <Tag className={cn("rounded-[var(--radius-panel)] border border-line bg-surface", className)}>{children}</Tag>;
}

/** Page title block: one h1, a short description, actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-fg">{title}</h1>
        {description && <p className="mt-2 text-[15px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon: IconName; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="bg-obsidian-gradient grid h-11 w-11 place-items-center rounded-xl">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="mt-4 text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}
