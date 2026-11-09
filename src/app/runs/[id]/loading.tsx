import { Skeleton } from "@/components/ui/Card";

export default function RunLoading() {
  return (
    <div aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-5 h-10 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-56" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_440px]">
        <Skeleton className="hidden h-96 rounded-xl lg:block" />
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
        <Skeleton className="hidden h-[520px] rounded-xl xl:block" />
      </div>
    </div>
  );
}
