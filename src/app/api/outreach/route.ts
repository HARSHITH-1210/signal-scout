import { handle, json } from "@/lib/api/http";
import { outreachStats } from "@/lib/outreach/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Outreach numbers from stored runs. Makes no Gmail calls. */
export const GET = handle(async () => json(outreachStats()));
