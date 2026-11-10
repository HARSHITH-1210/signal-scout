import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { runPipeline } from "@/lib/pipeline/runner";
import { GMAIL_METADATA_SCOPE, GMAIL_SEND_SCOPE, setGmailFetchForTests } from "@/lib/gmail/client";
import { classifyThread, refreshTracking, type GmailThread } from "@/lib/gmail/tracking";
import { computeOutreach, type OutreachRow } from "@/lib/outreach/stats";
import { outreachStats } from "@/lib/outreach/load";
import type { SentRecord } from "@/lib/types";
import { deps } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch } from "../fixtures/scenarios";

const REP = "rep@example.com";
const NOW = new Date("2026-11-05T12:00:00Z");
const sent = (o: Partial<SentRecord> = {}): SentRecord => ({
  to: "priya@example.com", from: "rep@example.com", version: 1, messageId: "m1", threadId: "t1", sentAt: "2026-11-05T10:00:00Z", ...o,
});
const msg = (id: string, from: string, extra: Record<string, string> = {}, at = "2026-11-05T11:00:00Z"): GmailThread["messages"][number] => ({
  id,
  internalDate: String(new Date(at).getTime()),
  payload: { headers: [{ name: "From", value: from }, ...Object.entries(extra).map(([name, value]) => ({ name, value }))] },
});
const thread = (...extra: GmailThread["messages"]): GmailThread => ({ messages: [msg("m1", "Rep <rep@example.com>"), ...extra] });

describe("classifyThread (headers only)", () => {
  it("is pending right after sending, then delivered when no bounce arrives", () => {
    expect(classifyThread(thread(), sent({ sentAt: "2026-11-05T11:55:00Z" }), NOW).state).toBe("pending");
    expect(classifyThread(thread(), sent(), NOW).state).toBe("delivered");
  });
  it("detects a human reply, ignoring our own follow-ups", () => {
    expect(classifyThread(thread(msg("m2", "Rep <rep@example.com>")), sent(), NOW).state).toBe("delivered");
    expect(classifyThread(thread(msg("m2", "Priya Raman <priya@example.com>")), sent(), NOW)).toMatchObject({ state: "replied", eventAt: "2026-11-05T11:00:00.000Z" });
  });
  it("detects bounces and auto-replies", () => {
    expect(classifyThread(thread(msg("m2", "Mail Delivery Subsystem <mailer-daemon@googlemail.com>")), sent(), NOW).state).toBe("bounced");
    expect(classifyThread(thread(msg("m2", "Priya <priya@example.com>", { "Auto-Submitted": "auto-replied" })), sent(), NOW).state).toBe("auto_reply");
    expect(classifyThread(thread(msg("m2", "Priya <priya@example.com>", { Subject: "Automatic reply: Mexico lanes" })), sent(), NOW).state).toBe("auto_reply");
  });
});

describe("refreshTracking", () => {
  let calls: string[];
  beforeEach(() => {
    useInMemoryDbForTests();
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-secret-value";
    calls = [];
    setGmailFetchForTests(async (url) => {
      calls.push(url);
      return Response.json(thread(msg("m2", "Priya <priya@example.com>")));
    });
  });
  const connect = (scopes: string[]) =>
    repo.saveGmailConnection({ email: "rep@example.com", refreshToken: "1//r", accessToken: "ya29.ok", accessTokenExpiresAt: Date.now() + 3_600_000, connectedAt: "", autoSendOnApprove: true, scopes });

  it("does nothing without the header permission (older connections)", async () => {
    connect([GMAIL_SEND_SCOPE]);
    expect((await refreshTracking(REP)).skipped).toBe("no_permission");
    expect(calls).toHaveLength(0);
  });

  it("checks sent threads with metadata format, stores the result, and throttles repeat checks", async () => {
    connect([GMAIL_SEND_SCOPE, GMAIL_METADATA_SCOPE]);
    const run = repo.createRun(NORTHWIND);
    repo.updateRun(run.id, { status: "sent", sent: sent({ messageId: "m1" }) });
    const first = await refreshTracking(REP, { now: NOW });
    expect(first).toMatchObject({ checked: 1, error: null });
    expect(calls[0]).toMatch(/threads\/t1\?format=metadata/);
    expect(repo.getRun(run.id)?.sent?.tracking?.state).toBe("replied");
    // Replied is final: never re-checked.
    expect((await refreshTracking(REP, { force: true, now: NOW })).checked).toBe(0);
  });

  it("reports an auth failure as a message, not a crash", async () => {
    connect([GMAIL_SEND_SCOPE, GMAIL_METADATA_SCOPE]);
    setGmailFetchForTests(async () => new Response("{}", { status: 401 }));
    const run = repo.createRun(NORTHWIND);
    repo.updateRun(run.id, { status: "sent", sent: sent() });
    expect((await refreshTracking(REP, { now: NOW })).error).toMatch(/sign in again/);
  });
});

describe("computeOutreach", () => {
  const row = (o: Partial<OutreachRow>): OutreachRow => ({
    runId: "r", label: "Northwind", status: "awaiting_review", createdAt: "2026-11-01T00:00:00Z", error: null, hookType: "hiring",
    hold: null, badNews: false, draft: { version: 1, subject: "s", expiresAt: "2026-11-20T00:00:00Z" }, sent: null, ...o,
  });

  it("counts the funnel, tiles and reply rate", () => {
    const stats = computeOutreach(
      [
        row({ runId: "a" }),
        row({ runId: "b", draft: { version: 1, subject: "s", expiresAt: "2026-11-06T00:00:00Z" } }),
        row({ runId: "c", status: "sent", sent: { ...sent(), subject: "Hi", tracking: { state: "replied", checkedAt: "x", eventAt: "2026-11-05T11:00:00Z" } } }),
        row({ runId: "d", status: "sent", hookType: "funding", sent: { ...sent(), subject: "Hi", tracking: { state: "delivered", checkedAt: "y", eventAt: null } } }),
        row({ runId: "e", status: "sent", sent: { ...sent(), subject: "Hi", tracking: { state: "bounced", checkedAt: "z", eventAt: null } } }),
        row({ runId: "f", status: "insufficient_research", draft: null }),
      ],
      NOW,
    );
    expect(stats.tiles).toMatchObject({ needsReview: 2, expiringSoon: 1, sent: 3, delivered: 2, replied: 1, bounced: 1, replyRate: 0.5 });
    expect(stats.funnel.map((f) => f.count)).toEqual([6, 5, 3, 3, 2, 1]);
    expect(stats.byHook).toEqual([
      { hookType: "hiring", sent: 2, replied: 1 },
      { hookType: "funding", sent: 1, replied: 0 },
    ]);
    expect(stats.perDay.at(-1)).toEqual({ date: "2026-11-05", count: 3 });
    expect(stats.lastCheckedAt).toBe("z");
  });

  it("orders the action queue: failed sends and holds first, expired last", () => {
    const stats = computeOutreach(
      [
        row({ runId: "expired", draft: { version: 1, subject: "s", expiresAt: "2026-11-01T00:00:00Z" } }),
        row({ runId: "review" }),
        row({ runId: "failed", status: "approved", error: "Approved, but not sent: Quota exceeded" }),
        row({ runId: "bad", badNews: true }),
        row({ runId: "optout", status: "held", hold: { kind: "do_not_contact", match: "x", note: null, overridden: false } }),
      ],
      NOW,
    );
    expect(stats.actions.map((a) => [a.runId, a.kind])).toEqual([
      ["failed", "send_failed"],
      ["bad", "bad_news"],
      ["review", "review"],
      ["expired", "expired"],
    ]);
    expect(stats.actions[0].note).toBe("Quota exceeded");
  });

  it("loads real runs from the database", async () => {
    useInMemoryDbForTests();
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    const stats = outreachStats(NOW);
    expect(stats.tiles.needsReview).toBe(1);
    expect(stats.actions[0]).toMatchObject({ runId: run.id, kind: "review" });
  });
});
