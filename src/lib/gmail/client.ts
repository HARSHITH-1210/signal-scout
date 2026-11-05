import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getConfig, redact } from "../config";
import { getGmailConnection, saveGmailConnection, type GmailConnection } from "../db/repo";

// Send-only: the app can send as the user but can never read their mailbox.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });

/** Tests substitute the network. Product code never calls this. */
export function setGmailFetchForTests(impl: FetchLike) {
  fetchImpl = impl;
}

export class GmailError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "auth" | "rejected" | "unavailable",
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export function gmailConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.googleClientId && c.googleClientSecret);
}

function requireConfig() {
  const c = getConfig();
  if (!c.googleClientId || !c.googleClientSecret)
    throw new GmailError("Gmail isn't set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local and restart.", "config");
  return { clientId: c.googleClientId, clientSecret: c.googleClientSecret, redirectUri: c.googleRedirectUri };
}

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizationUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});

async function tokenRequest(body: Record<string, string>) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  }).catch((e: unknown) => {
    throw new GmailError(`Couldn't reach Google: ${redact(e instanceof Error ? e.message : String(e))}`, "unavailable");
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new GmailError(
      code === "invalid_grant" ? "Gmail access was revoked or expired. Reconnect Gmail in Sender profile." : `Google rejected the token request (${code}).`,
      code === "invalid_grant" ? "auth" : "rejected",
    );
  }
  const parsed = TokenResponse.safeParse(json);
  if (!parsed.success) throw new GmailError("Google returned an unexpected token response.", "unavailable");
  return parsed.data;
}

/** The email address in a Google id_token. It came straight from Google over TLS, so it isn't re-verified. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/** Completes the OAuth flow and stores the connection (tokens stay server-side). */
export async function connectWithCode(code: string): Promise<GmailConnection> {
  const { clientId, clientSecret, redirectUri } = requireConfig();
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
  if (!tokens.scope?.split(" ").includes(GMAIL_SCOPES[0]))
    throw new GmailError("Send permission wasn't granted. Connect again and allow Signal Scout to send email.", "rejected");
  if (!tokens.refresh_token) throw new GmailError("Google didn't return a refresh token. Remove Signal Scout's access in your Google account and connect again.", "rejected");
  const email = emailFromIdToken(tokens.id_token);
  if (!email) throw new GmailError("Couldn't read which Gmail account was connected.", "rejected");
  const previous = getGmailConnection();
  const connection: GmailConnection = {
    email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    connectedAt: new Date().toISOString(),
    autoSendOnApprove: previous?.autoSendOnApprove ?? true,
  };
  saveGmailConnection(connection);
  return connection;
}

async function accessToken(connection: GmailConnection): Promise<string> {
  if (connection.accessToken && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt - Date.now() > 60_000) return connection.accessToken;
  const { clientId, clientSecret } = requireConfig();
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: connection.refreshToken, client_id: clientId, client_secret: clientSecret });
  saveGmailConnection({ ...connection, accessToken: tokens.access_token, accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000 });
  return tokens.access_token;
}

/** Sends one prepared message. Returns Gmail's message id. Not retried: a retry could send twice. */
export async function sendRaw(connection: GmailConnection, raw: string): Promise<string> {
  const token = await accessToken(connection);
  const res = await fetchImpl(SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  }).catch((e: unknown) => {
    throw new GmailError(`Couldn't reach Gmail; the email may not have been sent. Check your Sent folder before retrying. (${redact(e instanceof Error ? e.message : String(e))})`, "unavailable");
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new GmailError("Gmail refused the send. Reconnect Gmail in Sender profile.", "auth");
    throw new GmailError(`Gmail couldn't send the email (${redact(json.error?.message ?? `HTTP ${res.status}`)}).`, "rejected");
  }
  if (!json.id) throw new GmailError("Gmail accepted the request but returned no message id. Check your Sent folder.", "unavailable");
  return json.id;
}

/** Revokes Google access (best effort) and forgets the connection. */
export async function revoke(connection: GmailConnection): Promise<void> {
  await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: connection.refreshToken }).toString(),
  }).catch(() => undefined);
}
