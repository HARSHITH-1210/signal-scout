import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { missingSettings } from "@/lib/config";
import { getContactRules } from "@/lib/db/repo";
import { DiscoverQuery, discoverCompanies } from "@/lib/discover/discover";
import { ProviderError } from "@/lib/errors";
import { currentDeps } from "@/lib/pipeline/runner";
import { preflight } from "@/lib/providers/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finds companies named in web results for the rep's query. Read-only: it starts no run and sends nothing. */
export const POST = handle(async (request: Request) => {
  const body = await readJson(request);
  if (body === undefined) return badRequest("Request body must be JSON.");
  const parsed = DiscoverQuery.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Enter a search.", { query: parsed.error.issues[0]?.message ?? "Invalid search." });

  const missing = missingSettings();
  if (missing.length > 0) return json({ error: `Discover needs ${missing.join(" and ")}. Add ${missing.length > 1 ? "them" : "it"} to .env.local and restart.` }, 503);
  const ready = preflight();
  if (!ready.ok) return json({ error: ready.error }, 503);

  try {
    const result = await discoverCompanies(parsed.data.query, currentDeps(), getContactRules());
    return json(result);
  } catch (error) {
    // Provider messages are written to be safe to show.
    if (error instanceof ProviderError) return json({ error: error.message }, 502);
    throw error;
  }
});
