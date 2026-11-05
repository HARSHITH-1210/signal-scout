import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { AttachmentList, resolveAttachments } from "@/lib/api/attachments";
import { createRun, findRecentDuplicate, listRuns } from "@/lib/db/repo";
import { enqueueRun } from "@/lib/pipeline/runner";
import { preflight } from "@/lib/providers/preflight";
import { validateProspect } from "@/lib/pipeline/validate";
import { RUN_STATUSES, type RunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const status = new URL(request.url).searchParams.get("status");
  if (status && !RUN_STATUSES.includes(status as RunStatus)) return badRequest("Unknown status filter.");
  return json({ runs: listRuns({ status: (status as RunStatus) || undefined }) });
});

const Envelope = z.object({
  documents: AttachmentList.optional(),
  /** Start a new run even if the same prospect was researched in the last 24 hours. */
  force: z.boolean().optional(),
});

export const POST = handle(async (request: Request) => {
  const body = await readJson(request);
  if (body === undefined) return badRequest("Request body must be JSON.");
  const envelope = Envelope.safeParse(body);
  if (!envelope.success) return badRequest("Attachments are malformed.");
  const attachments = resolveAttachments(envelope.data.documents ?? []);
  if (!attachments.ok) return badRequest(attachments.error);

  const result = validateProspect(body, { allowEmpty: attachments.documents.length > 0 });
  if (!result.ok) return badRequest("Please fix the highlighted fields.", result.errors);

  if (!envelope.data.force && attachments.documents.length === 0) {
    const duplicate = findRecentDuplicate(result.value);
    if (duplicate) return json({ error: "You researched this prospect recently.", duplicate }, 409);
  }
  const ready = preflight();
  if (!ready.ok) return json({ error: ready.error, retryAt: ready.retryAt }, 503);
  const run = createRun(result.value, attachments.documents);
  enqueueRun(run.id);
  return json({ id: run.id, status: "queued" }, 202);
});
