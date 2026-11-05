import { conflict, handle, json, notFound } from "@/lib/api/http";
import { getRun, updateRun, addEvent } from "@/lib/db/repo";
import { enqueueRun } from "@/lib/pipeline/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The rep checked the existing relationship and wants to research anyway. Opt-outs can't be overridden. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return notFound();
  if (run.status !== "held" || !run.hold) return conflict("This run isn't on hold.");
  if (run.hold.kind === "do_not_contact") return conflict("This contact opted out. Remove them from the do-not-contact list under Contacts if that's wrong.");
  updateRun(id, { hold: { ...run.hold, overridden: true }, limitations: [] });
  addEvent(id, "validate", "succeeded", `Rep chose to research despite the existing relationship (${run.hold.match}).`);
  enqueueRun(id, "full");
  return json({ id, status: "queued" }, 202);
});
