import { describe, expect, it } from "vitest";
import { authEnabled, isEmailAllowed, isPublicPath, parseAllowList, safeNextPath, sessionSecret, signSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-session-secret";
const later = () => Date.now() + 60_000;

describe("session cookie", () => {
  it("round-trips a signed session", async () => {
    const token = await signSession({ email: "rep@example.com", exp: later() }, SECRET);
    expect(await verifySession(token, SECRET)).toMatchObject({ email: "rep@example.com" });
  });

  it("rejects a tampered payload, a wrong secret, junk and an expired session", async () => {
    const token = await signSession({ email: "rep@example.com", exp: later() }, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ email: "attacker@example.com", exp: later() })).toString("base64url")}.${sig}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
    expect(await verifySession(token, "other-secret")).toBeNull();
    expect(await verifySession("not-a-token", SECRET)).toBeNull();
    expect(await verifySession(`${token}.extra`, SECRET)).toBeNull();
    expect(await verifySession(null, SECRET)).toBeNull();
    expect(await verifySession(token, null)).toBeNull();
    const expired = await signSession({ email: "rep@example.com", exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(expired, SECRET)).toBeNull();
  });
});

describe("sign-in rules", () => {
  it("is on only when the Google OAuth client is configured", () => {
    expect(authEnabled({})).toBe(false);
    expect(authEnabled({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(authEnabled({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" })).toBe(true);
  });

  it("prefers SESSION_SECRET and otherwise derives one from the client secret", () => {
    expect(sessionSecret({ SESSION_SECRET: "explicit", GOOGLE_CLIENT_SECRET: "s" })).toBe("explicit");
    expect(sessionSecret({ GOOGLE_CLIENT_SECRET: "s" })).toMatch(/s$/);
    expect(sessionSecret({ GOOGLE_CLIENT_SECRET: "s" })).not.toBe("s");
    expect(sessionSecret({})).toBeNull();
  });

  it("matches ALLOWED_EMAILS by address or @domain, case-insensitively", () => {
    const list = parseAllowList(" Rep@Example.com, @acme.test ,");
    expect(list).toEqual(["rep@example.com", "@acme.test"]);
    expect(isEmailAllowed("REP@example.com", list)).toBe(true);
    expect(isEmailAllowed("anyone@acme.test", list)).toBe(true);
    expect(isEmailAllowed("someone@evil-acme.test", list)).toBe(false);
    expect(isEmailAllowed("other@example.com", list)).toBe(false);
    expect(isEmailAllowed("other@example.com", [])).toBe(true);
  });

  it("only returns to same-site paths after sign-in", () => {
    expect(safeNextPath("/runs/abc?x=1")).toBe("/runs/abc?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/signin")).toBe("/");
    expect(safeNextPath("/api/gmail")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it("leaves only the sign-in flow and the uptime ping public", () => {
    for (const p of ["/signin", "/api/auth/signin", "/api/gmail/callback", "/api/health"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/runs", "/api/runs", "/api/gmail", "/api/auth/signout", "/settings"]) expect(isPublicPath(p)).toBe(false);
  });
});
