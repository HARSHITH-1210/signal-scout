import { NextResponse } from "next/server";
import { getConfig, logError } from "@/lib/config";
import { connectWithCode, GmailError } from "@/lib/gmail/client";

/** The app's public origin: from GOOGLE_REDIRECT_URI, which must be public for Google to reach it. */
function publicOrigin(request: Request): string {
  try {
    return new URL(getConfig().googleRedirectUri).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>) {
  // Behind a proxy (Render), request.url is the server's internal address (0.0.0.0:10000). The
  // configured redirect URI is the public origin Google just sent the browser to, so return there.
  const url = new URL("/settings", publicOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: "gmail_oauth_state", path: "/api/gmail" });
  return res;
}

/** Google redirects here after sign-in. The state must match the cookie set by /connect. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = request.headers.get("cookie")?.match(/(?:^|;\s*)gmail_oauth_state=([^;]+)/)?.[1];
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back(request, { gmail: "error", reason: "Google sign-in was cancelled or denied." });
  if (!expected || !state || state !== expected) return back(request, { gmail: "error", reason: "The sign-in link expired or didn't match. Try connecting again from this browser." });
  const code = url.searchParams.get("code");
  if (!code) return back(request, { gmail: "error", reason: "Google didn't return an authorisation code." });
  try {
    const connection = await connectWithCode(code);
    return back(request, { gmail: "connected", account: connection.email });
  } catch (error) {
    if (!(error instanceof GmailError)) logError("gmail callback", error);
    return back(request, { gmail: "error", reason: error instanceof GmailError ? error.message : "Connecting Gmail failed. See the server log." });
  }
}
