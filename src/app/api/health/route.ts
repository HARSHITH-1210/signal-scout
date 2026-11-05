import { handle, json } from "@/lib/api/http";
import { getHealth } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which keys are configured (booleans only, never values). */
export const GET = handle(async () => json(getHealth()));
