import { NextResponse } from "next/server";
import { handle, json } from "@/lib/api/http";
import { authorizationUrl, gmailConfigured, newOAuthState } from "@/lib/gmail/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts Google sign-in. A random state, kept in an HttpOnly cookie, guards the callback against CSRF. */
export const GET = handle(async () => {
  if (!gmailConfigured()) return json({ error: "Gmail isn't set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local and restart." }, 400);
  const state = newOAuthState();
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set("gmail_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/api/gmail", maxAge: 600 });
  return res;
});
