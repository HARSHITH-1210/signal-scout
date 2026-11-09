import { NextResponse } from "next/server";
import { getConfig, logError } from "@/lib/config";
import { connectWithCode, GmailError, NeedsConsentError } from "@/lib/gmail/client";
import { authorizeSignIn, issueSession, OAUTH_COOKIE_PATH, OAUTH_NEXT_COOKIE, OAUTH_STATE_COOKIE } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The app's public origin: from GOOGLE_REDIRECT_URI, which must be public for Google to reach it. */
function publicOrigin(request: Request): string {
  try {
    return new URL(getConfig().googleRedirectUri).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

// Behind a proxy (Render), request.url is the server's internal address (0.0.0.0:10000). The configured
// redirect URI is the public origin Google just sent the browser to, so return there.
function redirectTo(request: Request, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, publicOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_COOKIE_PATH });
  res.cookies.delete({ name: OAUTH_NEXT_COOKIE, path: OAUTH_COOKIE_PATH });
  return res;
}

const failed = (request: Request, reason: string) => redirectTo(request, "/signin", { error: reason });

function readCookie(request: Request, name: string): string | undefined {
  const value = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  return value === undefined ? undefined : decodeURIComponent(value);
}

/**
 * Google redirects here after sign-in. The state must match the cookie set by /api/auth/signin. On
 * success the account is both the signed-in rep and the Gmail account approved drafts are sent from.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = readCookie(request, OAUTH_STATE_COOKIE);
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return failed(request, "Google sign-in was cancelled or denied.");
  if (!expected || !state || state !== expected) return failed(request, "The sign-in link expired or didn't match. Try again from this browser.");
  const code = url.searchParams.get("code");
  if (!code) return failed(request, "Google didn't return an authorisation code.");
  const next = safeNextPath(readCookie(request, OAUTH_NEXT_COOKIE));
  try {
    const connection = await connectWithCode(code, authorizeSignIn);
    const res = redirectTo(request, next);
    await issueSession(res, connection.email);
    return res;
  } catch (error) {
    // A new account signed in without the consent screen: go round once more with it.
    if (error instanceof NeedsConsentError) return redirectTo(request, `/api/auth/signin?consent=1&next=${encodeURIComponent(next)}`);
    if (!(error instanceof GmailError)) logError("google sign-in callback", error);
    return failed(request, error instanceof GmailError ? error.message : "Signing in failed. See the server log.");
  }
}
