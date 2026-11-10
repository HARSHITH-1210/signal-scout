import { z } from "zod";
import { handle, json, readJson } from "@/lib/api/http";
import { refreshTracking } from "@/lib/gmail/tracking";
import { outreachStats } from "@/lib/outreach/load";
import { requestUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks sent threads for replies and bounces (headers only), then returns fresh numbers. */
export const POST = handle(async (request: Request) => {
  const body = z.object({ force: z.boolean().optional() }).safeParse((await readJson(request)) ?? {});
  const result = await refreshTracking(await requestUser(request), { force: body.success ? body.data.force : false });
  return json({ result, stats: outreachStats() });
});
