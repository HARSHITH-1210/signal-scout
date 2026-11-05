import { badRequest, conflict, handle, json, notFound, readJson } from "@/lib/api/http";
import { getRun } from "@/lib/db/repo";
import { applyClarification, enqueueRun } from "@/lib/pipeline/runner";
import { validateClarification } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!getRun(id)) return notFound();
  const body = await readJson(request);
  const result = validateClarification(body ?? {});
  if (!result.ok) return badRequest("Please pick a candidate or add more details.", result.errors);
  const applied = applyClarification(id, result.value);
  if (!applied.ok) return conflict(applied.error);
  enqueueRun(id, applied.mode);
  return json({ id, status: "queued" }, 202);
});
