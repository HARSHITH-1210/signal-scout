import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { getContactRules, saveContactRules } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entry = z.string().trim().min(1).max(200);
const RulesSchema = z.object({
  doNotContact: z.array(Entry).max(1000),
  relationships: z.array(z.object({ match: Entry, note: z.string().trim().max(300) })).max(1000),
});

export const GET = handle(async () => json({ rules: getContactRules() }));

export const PUT = handle(async (request: Request) => {
  const parsed = RulesSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid contact list.");
  saveContactRules(parsed.data);
  return json({ rules: parsed.data });
});
