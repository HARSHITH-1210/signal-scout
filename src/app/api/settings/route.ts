import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { getSenderProfile, saveSenderProfile } from "@/lib/db/repo";
import { validateSenderProfile } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => json({ profile: getSenderProfile() }));

export const PUT = handle(async (request: Request) => {
  const result = validateSenderProfile(await readJson(request));
  if (!result.ok) return badRequest("Please fix the highlighted fields.", result.errors);
  saveSenderProfile(result.value);
  return json({ profile: result.value });
});
