import Link from "next/link";
import { getRunDetail } from "@/lib/db/repo";
import { gmailStatus } from "@/lib/gmail/send";
import { RunView } from "@/components/run/RunView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getRunDetail(id, { forClient: true });
  if (!detail) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Run not found</h1>
        <p className="mt-2 text-sm text-fg-soft">It may have been created on a different database.</p>
        <Link href="/runs" className="mt-4 inline-block font-medium text-primary hover:underline">Back to runs</Link>
      </div>
    );
  }
  return <RunView initial={detail} gmail={gmailStatus()} />;
}
