import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { getContactRules, saveContactRules } from "@/lib/db/repo";
import { MAX_ENTRIES_PER_LIST, MAX_ENTRY_LENGTH, MAX_NOTE_LENGTH, validateContactRules } from "@/lib/contacts/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entry = z.string().trim().min(1).max(MAX_ENTRY_LENGTH);
const RulesSchema = z.object({
  doNotContact: z.array(Entry).max(MAX_ENTRIES_PER_LIST),
  relationships: z
    .array(
      z.object({
        match: Entry,
        kind: z.enum(["customer", "open_deal", "past_contact", "partner", "other"]).optional(),
        note: z.string().trim().max(MAX_NOTE_LENGTH),
      }),
    )
    .max(MAX_ENTRIES_PER_LIST),
});

export const GET = handle(async () => json({ rules: getContactRules() }));

/** Saves both lists. Entries are normalised (lowercased emails and domains, URLs reduced to domains) and de-duplicated. */
export const PUT = handle(async (request: Request) => {
  const parsed = RulesSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid contact list.");
  const checked = validateContactRules(parsed.data);
  if (!checked.ok) return badRequest(checked.error);
  saveContactRules(checked.value);
  return json({ rules: checked.value });
});
