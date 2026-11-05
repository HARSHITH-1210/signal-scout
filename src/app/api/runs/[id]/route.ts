import { conflict, handle, json, notFound } from "@/lib/api/http";
import { deleteRun, getRun, getRunDetail } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const detail = getRunDetail(id, { forClient: true });
  return detail ? json(detail) : notFound();
});

/** Deletes a run and everything it collected. Refused while the pipeline is still working on it. */
export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return notFound();
  if (run.status === "queued" || run.status === "running") return conflict("Wait for the run to finish before deleting it.");
  deleteRun(id);
  return json({ deleted: true });
});
