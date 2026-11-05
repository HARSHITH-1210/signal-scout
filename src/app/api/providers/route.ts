import { handle, json } from "@/lib/api/http";
import { providerStatus } from "@/lib/providers/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider health for the System status panel. Makes no external calls. */
export const GET = handle(async () => json({ providers: providerStatus() }));
