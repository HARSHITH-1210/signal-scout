import { listRuns } from "@/lib/db/repo";
import { RunDashboard } from "@/components/RunDashboard";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  return <RunDashboard initialRuns={listRuns()} />;
}
