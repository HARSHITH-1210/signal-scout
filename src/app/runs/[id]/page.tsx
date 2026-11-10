import { notFound } from "next/navigation";
import { getRunDetail } from "@/lib/db/repo";
import { gmailStatus } from "@/lib/gmail/send";
import { currentUser } from "@/lib/auth/server";
import { RunView } from "@/components/run/RunView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getRunDetail(id, { forClient: true });
  if (!detail) notFound();
  return <RunView initial={detail} gmail={gmailStatus((await currentUser())?.email ?? null)} />;
}
