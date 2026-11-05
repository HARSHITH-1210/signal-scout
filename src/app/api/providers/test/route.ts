import { handle, json } from "@/lib/api/http";
import { probeProviders, providerStatus } from "@/lib/providers/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Test connections": cheap live key checks (no model tokens, no search credits), then fresh status. */
export const POST = handle(async () => json({ results: await probeProviders(), providers: providerStatus() }));
