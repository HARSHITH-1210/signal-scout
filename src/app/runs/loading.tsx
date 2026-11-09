import { Skeleton } from "@/components/ui/Card";

export default function RunsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading runs">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <Skeleton className="mt-8 h-9 w-full max-w-lg" />
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="hidden h-4 w-20 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
