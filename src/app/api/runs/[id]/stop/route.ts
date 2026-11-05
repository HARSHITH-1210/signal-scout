import { conflict, handle, json, notFound } from "@/lib/api/http";
import { getRun } from "@/lib/db/repo";
import { stopRun } from "@/lib/pipeline/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stops a queued or running run. Everything collected so far is kept; it can be resumed later. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!getRun(id)) return notFound();
  const result = stopRun(id);
  if (!result.ok) return conflict(result.error);
  return json({ id, stopped: result.was }, 202);
});
