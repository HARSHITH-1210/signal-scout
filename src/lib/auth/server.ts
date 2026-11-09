import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getConfig } from "../config";
import { getOwnerEmail, setOwnerEmail } from "../db/repo";
import { authEnabled, isEmailAllowed, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionSecret, signSession, verifySession } from "./session";

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_NEXT_COOKIE = "oauth_next";
/** Covers /api/auth/signin (sets them) and /api/gmail/callback (reads them). */
export const OAUTH_COOKIE_PATH = "/api";

/** Cookies are Secure whenever the app's public address is https (hosted). */
export function secureCookies(): boolean {
  return getConfig().googleRedirectUri.startsWith("https://");
}

/**
 * Decides whether a Google account may sign in. With ALLOWED_EMAILS set, only those accounts. Without
 * it, the first account to sign in becomes the owner and is the only one let in afterwards, so a
 * single-rep workspace can't be taken over by any other Google user.
 */
export function authorizeSignIn(email: string): string | null {
  const { allowedEmails } = getConfig();
  if (allowedEmails.length > 0)
    return isEmailAllowed(email, allowedEmails) ? null : `${email} isn't allowed to use this Signal Scout. Ask the admin to add it to ALLOWED_EMAILS.`;
  const owner = getOwnerEmail();
  if (!owner) {
    setOwnerEmail(email.toLowerCase());
    return null;
  }
  return owner === email.toLowerCase() ? null : `This Signal Scout belongs to another Google account. Sign in with that account, or set ALLOWED_EMAILS.`;
}

/** Sets the signed session cookie on a response. */
export async function issueSession(res: NextResponse, email: string): Promise<void> {
  const secret = sessionSecret(process.env);
  if (!secret) throw new Error("No session secret: GOOGLE_CLIENT_SECRET is missing.");
  const token = await signSession({ email, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }, secret);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_TTL_SECONDS });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 0 });
}

/** The signed-in rep for server components, or null (also null when sign-in isn't configured). */
export async function currentUser(): Promise<{ email: string } | null> {
  if (!authEnabled(process.env)) return null;
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret(process.env));
  return session ? { email: session.email } : null;
}
