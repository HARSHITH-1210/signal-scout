import { NextResponse } from "next/server";
import { handle, json } from "@/lib/api/http";
import { authorizationUrl, gmailConfigured, newOAuthState } from "@/lib/gmail/client";
import { OAUTH_COOKIE_PATH, OAUTH_NEXT_COOKIE, OAUTH_STATE_COOKIE, secureCookies } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts "Sign in with Google", which also grants Gmail sending. A random state, kept in an HttpOnly
 * cookie, guards the callback against CSRF; `next` is where to land afterwards (same-site paths only).
 */
export const GET = handle(async (request: Request) => {
  if (!gmailConfigured()) return json({ error: "Google sign-in isn't set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and restart." }, 400);
  const url = new URL(request.url);
  const state = newOAuthState();
  const res = NextResponse.redirect(authorizationUrl(state, { consent: url.searchParams.get("consent") === "1" }));
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: OAUTH_COOKIE_PATH, maxAge: 600 };
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookie);
  res.cookies.set(OAUTH_NEXT_COOKIE, safeNextPath(url.searchParams.get("next")), cookie);
  return res;
});
