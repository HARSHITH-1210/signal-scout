import { conflict, handle, json, notFound } from "@/lib/api/http";
import { addEvent, getRun } from "@/lib/db/repo";
import { enqueueRun, resumeModeFor } from "@/lib/pipeline/runner";
import { preflight } from "@/lib/providers/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resumes a failed run from the stage it stopped at, reusing everything stored before it. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!getRun(id)) return notFound();
  const plan = resumeModeFor(id);
  if (!plan.ok) return conflict(plan.error);
  const ready = preflight();
  if (!ready.ok) return json({ error: ready.error, retryAt: ready.retryAt }, 503);
  addEvent(id, plan.from, "running", `Resuming from ${plan.from.replace(/_/g, " ")}; earlier results are reused.`);
  enqueueRun(id, plan.mode);
  return json({ id, status: "queued", from: plan.from }, 202);
});
