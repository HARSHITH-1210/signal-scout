// Google sign-in session: a stateless, HMAC-signed cookie. Pure functions on Web Crypto, so the same
// code runs in src/proxy.ts and in route handlers, and the rules are unit-tested.

export const SESSION_COOKIE = "ss_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface Session {
  email: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/** Paths reachable without signing in: the sign-in page and flow, and the uptime ping (booleans only). */
const PUBLIC_PATHS = new Set(["/signin", "/api/auth/signin", "/api/gmail/callback", "/api/health"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Sign-in is on whenever the Google OAuth client is configured. */
export function authEnabled(env: Record<string, string | undefined>): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/**
 * Key for signing sessions: SESSION_SECRET when set, otherwise derived from the OAuth client secret
 * (already a server-only secret), so sign-in needs no extra setup. Rotating either signs everyone out.
 */
export function sessionSecret(env: Record<string, string | undefined>): string | null {
  const explicit = env.SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const client = env.GOOGLE_CLIENT_SECRET?.trim();
  return client ? `signal-scout-session-v1:${client}` : null;
}

/** ALLOWED_EMAILS: comma-separated addresses or "@domain.com" entries. */
export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the list is empty (the owner rule applies instead) or the email matches an entry. */
export function isEmailAllowed(email: string, allowList: string[]): boolean {
  if (allowList.length === 0) return true;
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@"));
  return allowList.some((entry) => (entry.startsWith("@") ? entry === domain : entry === address));
}

/** Where to go after sign-in: only a same-site path, never another origin or the sign-in flow itself. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/signin") || next.startsWith("/api/")) return "/";
  return next.slice(0, 500);
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

/** The session in a cookie value, or null if it's missing, tampered with or expired. */
export async function verifySession(token: string | null | undefined, secret: string | null, now = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const sig = fromBase64Url(signature);
  if (!sig) return null;
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(payload));
  if (!valid) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Session>;
    if (typeof data.email !== "string" || typeof data.exp !== "number" || data.exp <= now) return null;
    return { email: data.email, exp: data.exp };
  } catch {
    return null;
  }
}
