import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { logError } from "@/lib/config";
import { getDocument } from "@/lib/db/repo";
import { relevantChunks } from "@/lib/documents/parse";
import { ProviderError } from "@/lib/errors";
import { createLlmProvider } from "@/lib/pipeline/runner";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/lib/pipeline/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Suggestion = z.object({
  companyName: z.string().nullable(),
  companyWebsite: z.string().nullable(),
  defaultCta: z.string().nullable(),
  sectors: z.array(
    z.object({
      name: z.string(),
      offerings: z.array(z.object({ name: z.string(), whatItDoes: z.string() })),
    }),
  ),
});

const SYSTEM = `You read a seller's own document (a one-pager, deck or case study) and suggest sender-profile fields for a sales rep to review. The profile is only about the seller's own business.
${UNTRUSTED_DATA_RULE}
- Fill a field only with what the document states; null (or an empty list) otherwise. Never invent products, customers, metrics or claims.
- sectors: group the seller's products or services into broad areas (e.g. "AI solutions", "Data & analytics"), at most 4 sectors with at most 6 offerings each. Use one sector if the document describes a single product.
- Each offering: name (short) and whatItDoes (1-2 plain sentences on what it does and, if the document says so, the outcome customers get).
- defaultCta: only if the document suggests one (e.g. a demo); otherwise null.
- companyWebsite: a bare domain only if it appears in the document.`;

/** One model call, triggered by the rep, that pre-fills the sender profile from an uploaded document. */
export const POST = handle(async (request: Request) => {
  const parsed = z.object({ documentId: z.string().uuid() }).safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Choose a document.");
  const doc = getDocument(parsed.data.documentId);
  if (!doc || doc.scope !== "sender") return badRequest("That document no longer exists.");
  try {
    const excerpt = relevantChunks(doc.text, "product platform customers helps teams value outcome results demo", 4, 1500).join("\n\n");
    const suggestion = await createLlmProvider().generate({
      task: "extract_profile",
      effort: "low",
      system: SYSTEM,
      user: wrapUntrusted({ id: "D1", url: `upload://${doc.name}`, title: doc.name, publishedDate: null, text: excerpt }),
      schema: Suggestion,
      maxTokens: 4000,
    });
    return json({ suggestion });
  } catch (error) {
    if (error instanceof ProviderError) return json({ error: error.message }, 502);
    logError("settings extract", error);
    throw error;
  }
});
