import { DiscoverSearch } from "@/components/DiscoverSearch";
import { PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/** Discover: find companies by description, then research one. */
export default function DiscoverPage() {
  return (
    <div className="telemetry mx-auto max-w-[920px]">
      <PageHeader title="Discover" label="Find companies · pick one to research" />
      <DiscoverSearch />
    </div>
  );
}
