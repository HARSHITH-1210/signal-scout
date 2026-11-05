import { describe, expect, it } from "vitest";
import { checkBasicAuth, checkRequest, isAllowedHost } from "@/lib/api/guard";

const base = { method: "POST", pathname: "/api/runs", host: "localhost:3000", origin: "http://localhost:3000", secFetchSite: "same-origin" };

describe("request guard", () => {
  it("answers only to hosts an attacker can't control (F-22, DNS rebinding)", () => {
    expect(isAllowedHost("localhost:3000")).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHost("[::1]:3000")).toBe(true);
    expect(isAllowedHost("192.168.0.104:3000")).toBe(true);
    expect(isAllowedHost("shanmukhs-macbook-pro.local:3000")).toBe(true);
    expect(isAllowedHost("attacker.example:3000")).toBe(false);
    expect(isAllowedHost("scout.mycompany.com", ["scout.mycompany.com"])).toBe(true);
    expect(isAllowedHost(null)).toBe(false);
  });

  it("allows same-origin writes and non-browser clients", () => {
    expect(checkRequest(base)).toEqual({ ok: true });
    expect(checkRequest({ ...base, origin: null, secFetchSite: null })).toEqual({ ok: true });
  });

  it("blocks cross-site writes, including simple text/plain posts (F-08)", () => {
    expect(checkRequest({ ...base, origin: "https://evil.example", secFetchSite: "cross-site" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...base, origin: "https://evil.example", secFetchSite: null })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...base, origin: "null", secFetchSite: null })).toMatchObject({ ok: false, status: 403 });
  });

  it("doesn't restrict reads or page loads beyond the host check", () => {
    expect(checkRequest({ ...base, method: "GET", origin: "https://evil.example", secFetchSite: "cross-site" })).toEqual({ ok: true });
    expect(checkRequest({ ...base, pathname: "/runs/new", origin: "https://evil.example" })).toEqual({ ok: true });
    expect(checkRequest({ ...base, method: "GET", host: "attacker.example" })).toMatchObject({ ok: false, status: 421 });
  });
});

describe("app password (hosted demos)", () => {
  const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  it("is off when no password is set", () => {
    expect(checkBasicAuth({ pathname: "/", authorization: null })).toBe(true);
  });
  it("requires the right username and password", () => {
    const opts = { pathname: "/runs/new", password: "s3cret-pass" };
    expect(checkBasicAuth({ ...opts, authorization: null })).toBe(false);
    expect(checkBasicAuth({ ...opts, authorization: basic("demo", "wrong") })).toBe(false);
    expect(checkBasicAuth({ ...opts, authorization: basic("other", "s3cret-pass") })).toBe(false);
    expect(checkBasicAuth({ ...opts, authorization: basic("demo", "s3cret-pass") })).toBe(true);
    expect(checkBasicAuth({ ...opts, username: "rep", authorization: basic("rep", "s3cret-pass") })).toBe(true);
    expect(checkBasicAuth({ ...opts, authorization: "Basic !!!" })).toBe(false);
  });
  it("leaves the uptime ping open, and nothing else", () => {
    expect(checkBasicAuth({ pathname: "/api/health", authorization: null, password: "x" })).toBe(true);
    expect(checkBasicAuth({ pathname: "/api/runs", authorization: null, password: "x" })).toBe(false);
    expect(checkBasicAuth({ pathname: "/api/gmail/callback", authorization: null, password: "x" })).toBe(false);
  });
});
