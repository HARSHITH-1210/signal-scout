import { Suspense } from "react";
import { listRuns } from "@/lib/db/repo";
import { RunDashboard } from "@/components/RunDashboard";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  return (
    <Suspense>
      <RunDashboard initialRuns={listRuns()} />
    </Suspense>
  );
}
