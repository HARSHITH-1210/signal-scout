import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, useInMemoryDbForTests } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { redact } from "@/lib/config";
import { runPipeline, setDepsFactory } from "@/lib/pipeline/runner";
import { authorizationUrl, connectWithCode, GMAIL_SCOPES, NeedsConsentError, sendRaw, setGmailFetchForTests } from "@/lib/gmail/client";
import { buildRawMessage, encodeHeader, isSafeAddress } from "@/lib/gmail/mime";
import { checkSendable } from "@/lib/gmail/send";
import { SESSION_COOKIE, sessionSecret, signSession } from "@/lib/auth/session";
import { POST as draftAction, PUT as editDraft } from "@/app/api/runs/[id]/draft/route";
import { GET as callback } from "@/app/api/gmail/callback/route";
import { deps } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch } from "../fixtures/scenarios";

// The signed-in rep's session cookie; route handlers send from that rep's own Gmail connection.
let sessionCookie = "";
const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", cookie: sessionCookie } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const decode = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

type Call = { url: string; init: RequestInit };
let calls: Call[];
let sendResponse: () => Response;
/** The Google account the fake token endpoint signs in. */
let googleAccount: string;

function fakeGoogle() {
  calls = [];
  googleAccount = "rep@example.com";
  sendResponse = () => Response.json({ id: "msg-123" });
  setGmailFetchForTests(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/token"))
      return Response.json({ access_token: "ya29.fresh-access-token", expires_in: 3600, refresh_token: "1//refresh-token-value-abcdef", id_token: idToken(googleAccount), scope: GMAIL_SCOPES.join(" ") });
    if (url.includes("/messages/send")) return sendResponse();
    return new Response(null, { status: 200 });
  });
}

function connect(autoSendOnApprove = true) {
  repo.saveGmailConnection({ email: "rep@example.com", refreshToken: "1//refresh", accessToken: "ya29.valid", accessTokenExpiresAt: Date.now() + 3_600_000, connectedAt: new Date().toISOString(), autoSendOnApprove });
}

async function readyRun(email: string | null = "priya@example.com") {
  const run = repo.createRun({ ...NORTHWIND, email: email ?? undefined });
  await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
  return run.id;
}

const REP = "rep@example.com";
const sends = () => calls.filter((c) => c.url.includes("/messages/send"));

const sessionFor = async (email: string) =>
  `${SESSION_COOKIE}=${await signSession({ email, exp: Date.now() + 3_600_000 }, sessionSecret(process.env)!)}`;

beforeEach(async () => {
  useInMemoryDbForTests();
  setDepsFactory(() => deps(northwindSearch(), northwindLlm()));
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-secret-value";
  sessionCookie = await sessionFor(REP);
  fakeGoogle();
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("MIME message", () => {
  it("builds a plain-text UTF-8 message Gmail accepts", () => {
    const text = decode(buildRawMessage({ from: "rep@example.com", to: "priya@example.com", subject: "Café expansion", body: "Hi Priya,\nThanks." }));
    expect(text).toContain("To: priya@example.com\r\n");
    expect(text).toContain("Subject: =?UTF-8?B?");
    const body = text.split("\r\n\r\n")[1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Hi Priya,\r\nThanks.");
  });

  it("keeps header injection out of addresses and subjects", () => {
    expect(isSafeAddress("a@b.co")).toBe(true);
    expect(isSafeAddress("a@b.co\r\nBcc: x@y.z")).toBe(false);
    expect(isSafeAddress("a@b.co, c@d.co")).toBe(false);
    expect(isSafeAddress("Name <a@b.co>")).toBe(false);
    expect(encodeHeader("Hi\r\nBcc: x@y.z")).toBe("Hi Bcc: x@y.z");
    expect(() => buildRawMessage({ from: "rep@example.com", to: "x@y.z\nBcc: evil@z.z", subject: "s", body: "b" })).toThrow();
  });
});

describe("Gmail OAuth client", () => {
  it("asks only for send permission, offline, with the state", () => {
    const url = new URL(authorizationUrl("state-1"));
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toMatch(/readonly|modify|mail\.google\.com/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("stores the connection from a code exchange, with send-on-approve on", async () => {
    const connection = await connectWithCode("code-1");
    expect(connection.email).toBe("rep@example.com");
    expect(repo.getGmailConnection(REP)).toMatchObject({ email: "rep@example.com", refreshToken: "1//refresh-token-value-abcdef", autoSendOnApprove: true });
  });

  it("lets reps pick their account, and forces the consent screen only when asked", () => {
    expect(new URL(authorizationUrl("s")).searchParams.get("prompt")).toBe("select_account");
    expect(new URL(authorizationUrl("s", { consent: true })).searchParams.get("prompt")).toBe("consent");
  });

  it("signs in without the send scope, but sending is refused until it's granted", async () => {
    setGmailFetchForTests(async () => Response.json({ access_token: "ya29.x", expires_in: 3600, refresh_token: "1//r", id_token: idToken("rep@example.com"), scope: "openid email" }));
    await connectWithCode("code");
    const id = await readyRun();
    expect(checkSendable(REP, id, 1, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/Send permission/) });
  });

  it("stores nothing when the account isn't allowed to sign in", async () => {
    await expect(connectWithCode("code", () => "Not you.")).rejects.toThrow("Not you.");
    expect(repo.getGmailConnection(REP)).toBeNull();
  });

  it("keeps the stored refresh token for a returning rep, and asks for consent for a new account", async () => {
    connect();
    const noRefresh = (email: string) => async () => Response.json({ access_token: "ya29.n", expires_in: 3600, id_token: idToken(email), scope: GMAIL_SCOPES.join(" ") });
    setGmailFetchForTests(noRefresh("rep@example.com"));
    expect((await connectWithCode("code")).refreshToken).toBe("1//refresh");
    setGmailFetchForTests(noRefresh("someone-else@example.com"));
    await expect(connectWithCode("code")).rejects.toBeInstanceOf(NeedsConsentError);
    expect(repo.getGmailConnection(REP)?.email).toBe("rep@example.com");
  });

  it("refreshes an expired access token before sending", async () => {
    repo.saveGmailConnection({ email: "rep@example.com", refreshToken: "1//refresh", accessToken: "ya29.old", accessTokenExpiresAt: Date.now() - 1000, connectedAt: "", autoSendOnApprove: true });
    expect(await sendRaw(repo.getGmailConnection(REP)!, "raw")).toEqual({ id: "msg-123", threadId: null });
    expect(calls[0].url).toContain("/token");
    expect(new Headers(calls[1].init.headers).get("authorization")).toBe("Bearer ya29.fresh-access-token");
    expect(repo.getGmailConnection(REP)?.accessToken).toBe("ya29.fresh-access-token");
  });

  it("asks to sign in again on 401 and never retries a send", async () => {
    connect();
    sendResponse = () => new Response("{}", { status: 401 });
    await expect(sendRaw(repo.getGmailConnection(REP)!, "raw")).rejects.toThrow(/sign in again/);
    expect(sends()).toHaveLength(1);
  });

  it("redacts Google tokens and the client secret", () => {
    expect(redact("token ya29.a0AfH6SMBxxxx and 1//0gLongRefreshTokenValue123 and GOCSPX-test-secret-value")).not.toMatch(/ya29\.a0|1\/\/0g|GOCSPX-test/);
  });
});

describe("checkSendable", () => {
  it("lists what's missing, in order", async () => {
    const id = await readyRun(null);
    expect(checkSendable(REP, id, 1, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/Sign in with Google/) });
    connect();
    expect(checkSendable(REP, id, 1, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/recipient's email/) });
    expect(checkSendable(REP, id, 1, "not an email")).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't valid/) });
    expect(checkSendable(REP, id, 2, "p@example.com")).toMatchObject({ ok: false, reason: expect.stringMatching(/newer version/) });
    expect(checkSendable(REP, id, 1, "p@example.com")).toEqual({ ok: true, to: "p@example.com", from: "rep@example.com" });
  });

  it("is refused when Gmail isn't configured", async () => {
    const id = await readyRun();
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(checkSendable(REP, id, 1, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't set up/) });
  });

  it("never sends a draft with blocking guard issues", async () => {
    const id = await readyRun();
    connect();
    await editDraft(req({ subject: "Edited", body: "Hi Priya, [COMPANY] is great. Read https://evil.example/x", baseVersion: 1 }, "PUT"), params(id));
    const result = checkSendable(REP, id, 2, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Fix/);
  });
});

describe("approve and send", () => {
  it("approves, sends the exact version once, and records the receipt", async () => {
    const id = await readyRun();
    connect();
    const res = await draftAction(req({ action: "approve", version: 1, send: true }), params(id));
    expect(res.status).toBe(200);
    expect(sends()).toHaveLength(1);
    const raw = decode(JSON.parse(String(sends()[0].init.body)).raw);
    expect(raw).toContain("To: priya@example.com");
    expect(raw).toContain("From: rep@example.com");
    const run = repo.getRun(id)!;
    expect(run).toMatchObject({ status: "sent", approvedVersion: 1, sent: { to: "priya@example.com", version: 1, messageId: "msg-123" } });
    expect(repo.listEvents(id).some((e) => /Sent version 1/.test(e.message))).toBe(true);

    // Idempotent: a second approve or send is refused and nothing more goes out.
    expect((await draftAction(req({ action: "approve", version: 1, send: true }), params(id))).status).toBe(409);
    expect((await draftAction(req({ action: "send", version: 1 }), params(id))).status).toBe(409);
    expect((await editDraft(req({ subject: "x", body: "y", baseVersion: 1 }, "PUT"), params(id))).status).toBe(409);
    expect(sends()).toHaveLength(1);
  });

  it("a blocked send doesn't approve: the draft stays in review", async () => {
    const id = await readyRun(null);
    connect();
    const res = await draftAction(req({ action: "approve", version: 1, send: true }), params(id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/recipient's email/);
    expect(repo.getRun(id)?.status).toBe("awaiting_review");
    expect(sends()).toHaveLength(0);
  });

  it("approving without send never contacts Gmail", async () => {
    const id = await readyRun();
    connect();
    expect((await draftAction(req({ action: "approve", version: 1 }), params(id))).status).toBe(200);
    expect(repo.getRun(id)?.status).toBe("approved");
    expect(calls).toHaveLength(0);
  });

  it("a failed send keeps the approval, explains why, and can be retried with Send now", async () => {
    const id = await readyRun();
    connect();
    sendResponse = () => Response.json({ error: { message: "Quota exceeded" } }, { status: 429 });
    const res = await draftAction(req({ action: "approve", version: 1, send: true }), params(id));
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe("approved");
    expect(repo.getRun(id)).toMatchObject({ status: "approved", sent: null, error: expect.stringMatching(/Approved, but not sent: .*Quota exceeded/) });

    sendResponse = () => Response.json({ id: "msg-456" });
    const retry = await draftAction(req({ action: "send", version: 1, to: "other@example.com" }), params(id));
    expect(retry.status).toBe(200);
    expect(repo.getRun(id)).toMatchObject({ status: "sent", error: null, sent: { to: "other@example.com", messageId: "msg-456" } });
  });

  it("Send now only works for the approved, latest version", async () => {
    const id = await readyRun();
    connect();
    expect((await draftAction(req({ action: "send", version: 1 }), params(id))).status).toBe(409); // not approved yet
    expect(sends()).toHaveLength(0);
  });
});

describe("Google sign-in callback", () => {
  const cb = (state: string) => callback(new Request(`http://localhost:3000/api/gmail/callback?code=c&state=${state}`, { headers: { cookie: "oauth_state=good; oauth_next=%2Fruns" } }));

  it("rejects a state that doesn't match the cookie", async () => {
    const res = await cb("evil");
    expect(res.headers.get("location")).toMatch(/\/signin\?error=/);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/ss_session=[^;]/);
    expect(calls).toHaveLength(0);
    expect(repo.getGmailConnection(REP)).toBeNull();
  });

  it("signs in, connects Gmail and returns to the page the rep asked for", async () => {
    const res = await cb("good");
    expect(res.headers.get("location")).toBe("http://localhost:3000/runs");
    expect(res.headers.get("set-cookie")).toMatch(/ss_session=[^;]+;.*HttpOnly/i);
    expect(repo.getGmailConnection(REP)?.email).toBe("rep@example.com");
    expect(repo.getOwnerEmail()).toBe("rep@example.com");
  });

  it("lets only the owner back in when ALLOWED_EMAILS is unset", async () => {
    repo.setOwnerEmail("owner@example.com");
    const res = await cb("good");
    expect(res.headers.get("location")).toMatch(/\/signin\?error=.*another\+Google\+account/);
    expect(repo.getGmailConnection(REP)).toBeNull();
  });

  it("follows ALLOWED_EMAILS when it is set", async () => {
    process.env.ALLOWED_EMAILS = "@other.test";
    try {
      expect((await cb("good")).headers.get("location")).toMatch(/\/signin\?error=.*ALLOWED_EMAILS/);
      process.env.ALLOWED_EMAILS = "@example.com";
      expect((await cb("good")).headers.get("location")).toBe("http://localhost:3000/runs");
    } finally {
      delete process.env.ALLOWED_EMAILS;
    }
  });
});

describe("several reps on one workspace", () => {
  const signIn = () =>
    callback(new Request("http://localhost:3000/api/gmail/callback?code=c&state=good", { headers: { cookie: "oauth_state=good; oauth_next=%2F" } }));

  it("lets every allowed account sign in, each with its own Gmail connection", async () => {
    process.env.ALLOWED_EMAILS = "rep@example.com, @team.example";
    try {
      expect((await signIn()).headers.get("location")).toBe("http://localhost:3000/");
      googleAccount = "colleague@team.example";
      expect((await signIn()).headers.get("location")).toBe("http://localhost:3000/");
      googleAccount = "stranger@elsewhere.example";
      expect((await signIn()).headers.get("location")).toMatch(/\/signin\?error=.*ALLOWED_EMAILS/);
    } finally {
      delete process.env.ALLOWED_EMAILS;
    }
    expect(repo.getGmailConnection("rep@example.com")?.email).toBe("rep@example.com");
    expect(repo.getGmailConnection("Colleague@Team.example")?.email).toBe("colleague@team.example");
    expect(repo.getGmailConnection("stranger@elsewhere.example")).toBeNull();
  });

  it("sends from the signed-in rep's own account, never a colleague's", async () => {
    const id = await readyRun();
    connect();
    sessionCookie = await sessionFor("colleague@team.example");
    const res = await draftAction(req({ action: "approve", version: 1, send: true }), params(id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Sign in with Google/) });
    expect(sends()).toHaveLength(0);
    expect(repo.getRun(id)?.status).toBe("awaiting_review");
  });

  it("refuses to send with no signed-in rep", async () => {
    const id = await readyRun();
    connect();
    sessionCookie = "";
    expect((await draftAction(req({ action: "approve", version: 1, send: true }), params(id))).status).toBe(409);
    expect(sends()).toHaveLength(0);
  });

  it("moves a connection saved before per-account storage to its owner only", () => {
    const legacy = { email: "rep@example.com", refreshToken: "1//old", accessToken: "", accessTokenExpiresAt: 0, connectedAt: "", autoSendOnApprove: false };
    getDb().prepare(`INSERT INTO settings (key, value_json) VALUES ('gmail', ?)`).run(JSON.stringify(legacy));
    expect(repo.getGmailConnection("colleague@team.example")).toBeNull();
    expect(repo.getGmailConnection(REP)).toMatchObject({ refreshToken: "1//old", autoSendOnApprove: false });
    expect(getDb().prepare(`SELECT 1 FROM settings WHERE key = 'gmail'`).get()).toBeUndefined();
    expect(repo.getGmailConnection(REP)?.refreshToken).toBe("1//old");
  });
});

describe("concurrent sends", () => {
  it("a second send while one is in flight is refused", async () => {
    const id = await readyRun();
    connect();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sendResponse = () => Response.json({ id: "msg-1" });
    setGmailFetchForTests(async (url, init) => {
      calls.push({ url, init });
      await gate;
      return sendResponse();
    });
    const first = draftAction(req({ action: "approve", version: 1, send: true }), params(id));
    await new Promise((r) => setTimeout(r, 0));
    const second = await draftAction(req({ action: "send", version: 1 }), params(id));
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(sends()).toHaveLength(1);
  });
});

describe("OAuth callback behind a proxy", () => {
  it("returns to the public origin, not the server's internal address", async () => {
    process.env.GOOGLE_REDIRECT_URI = "https://signal-scout-demo.onrender.com/api/gmail/callback";
    try {
      const res = await callback(new Request("http://0.0.0.0:10000/api/gmail/callback?code=c&state=good", { headers: { cookie: "oauth_state=good" } }));
      expect(res.headers.get("location")).toBe("https://signal-scout-demo.onrender.com/");
      expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
    } finally {
      delete process.env.GOOGLE_REDIRECT_URI;
    }
  });
});
