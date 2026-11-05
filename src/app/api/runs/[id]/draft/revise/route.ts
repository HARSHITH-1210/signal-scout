import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { reviseRunDraft } from "@/lib/pipeline/runner";
import { MAX_INSTRUCTION_LENGTH } from "@/lib/pipeline/stages/revise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReviseSchema = z.object({
  instruction: z.string().trim().min(1, "Tell the AI what to change or ask a question.").max(MAX_INSTRUCTION_LENGTH, `Keep the instruction under ${MAX_INSTRUCTION_LENGTH} characters.`),
  /** The editor's current text, so unsaved manual edits are revised rather than lost. */
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(5000),
  baseVersion: z.number().int().positive(),
});

/** Rewrite the latest draft from the rep's instruction (or answer their question). Never sends. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const parsed = ReviseSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.");
  const result = await reviseRunDraft(id, parsed.data);
  if (!result.ok) return json({ error: result.error, ...(result.latest ? { latest: result.latest } : {}) }, result.status);
  return json({ draft: result.draft, reply: result.reply, changed: result.changed });
});
