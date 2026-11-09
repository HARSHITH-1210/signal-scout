import { NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { clearSession } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends the session. Gmail stays connected for the next sign-in; revoking access is on the Sender page. */
export const POST = handle(async () => {
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
});
