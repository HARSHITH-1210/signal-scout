import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_SENDER_PROFILE } from "../fixtures/senderProfile";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { runPipeline, setDepsFactory } from "@/lib/pipeline/runner";
import { draftConfidence, draftExpiresAt, isExpired } from "@/lib/pipeline/confidence";
import { checkContactRules, entryMatches, parseRelationshipLines } from "@/lib/pipeline/contacts";
import { failsSwapTest, runDeterministicGuard } from "@/lib/pipeline/guard";
import { POST as draftAction } from "@/app/api/runs/[id]/draft/route";
import { POST as holdAction } from "@/app/api/runs/[id]/hold/route";
import type { Identity, Signal } from "@/lib/types";
import { deps, result, sourceIdFor } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch, NW } from "../fixtures/scenarios";

const req = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  useInMemoryDbForTests();
  repo.saveSenderProfile(SAMPLE_SENDER_PROFILE); // the app starts empty; these tests need a seller with offerings
  setDepsFactory(() => deps(northwindSearch(), northwindLlm()));
});
afterEach(() => vi.useRealTimers());

function signal(o: Partial<Signal>): Signal {
  return {
    id: "G1", type: "hiring", about: "company", claim: "Northwind Freight is hiring a Senior Accounts Payable Specialist.",
    evidenceQuote: "process more than 5,000 carrier invoices each month", sourceId: "S1", eventDate: null, relevance: 0.8, whyItMatters: "w",
    status: "verified", statusReason: null, freshness: "fresh", ageDays: 10, reliability: 0.9, corroboratingSourceIds: [], conflictGroup: null, score: 0.7, ...o,
  };
}
const identity = (o: Partial<Identity> = {}): Identity => ({
  status: "resolved", resolvedName: "Priya Raman", resolvedRole: "VP Finance", resolvedCompany: "Northwind Freight", companyDomain: "northwindfreight.com",
  companyDescription: null, reasoning: "", evidenceUrls: [], candidates: [], personConfirmed: true, confirmedByUser: false, ...o,
});
const guard = (body: string, extra: Partial<Parameters<typeof runDeterministicGuard>[1]> = {}) =>
  runDeterministicGuard({ subject: "s", body, signalIdsUsed: [] }, { signals: [], sources: [], staleHook: false, senderWebsite: "", ...extra }).map((i) => i.code);

describe("1. confidence label", () => {
  it("labels role-based drafts low and explains why", () => {
    expect(draftConfidence("role_based", undefined, identity(), [])).toMatchObject({ level: "low", basis: "role" });
  });
  it("is high only for a fresh hook about a confirmed person", () => {
    expect(draftConfidence("personalised", signal({ about: "person" }), identity(), []).level).toBe("high");
    expect(draftConfidence("personalised", signal({ about: "company" }), identity(), []).level).toBe("medium");
    expect(draftConfidence("personalised", signal({ about: "person" }), identity({ personConfirmed: false }), []).level).toBe("medium");
    expect(draftConfidence("personalised", signal({ freshness: "stale" }), identity(), []).level).toBe("low");
  });
});

describe("2. interesting but irrelevant", () => {
  it("a signal with no link to the offer can't become the hook", async () => {
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm({
      extract_signals: (r) => ({
        signals: [
          { type: "hiring", about: "company", claim: "Northwind Freight is hiring a Senior Accounts Payable Specialist.", evidenceQuote: "is hiring a Senior Accounts Payable Specialist", sourceId: sourceIdFor(r.user, NW.hiring.url), eventDate: null, relevance: 1, whyItMatters: "x", offerLink: null },
        ],
      }),
    });
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("insufficient_research");
    expect(d.signals[0].relevance).toBeLessThanOrEqual(0.3);
  });
});

describe("4. bad news", () => {
  const layoffs = result("https://www.reuters.com/northwind-layoffs", "Northwind Freight cuts staff", "Northwind Freight laid off 120 employees in October as freight volumes fell.", "2026-10-20");
  const llm = () =>
    northwindLlm({
      extract_signals: (r) => ({
        signals: [
          { type: "challenge", about: "company", claim: "Northwind Freight laid off 120 employees in October.", evidenceQuote: "Northwind Freight laid off 120 employees in October", sourceId: sourceIdFor(r.user, layoffs.url), eventDate: "2026-10", relevance: 1, whyItMatters: "x", offerLink: "x" },
          { type: "hiring", about: "company", claim: "Northwind Freight is hiring a Senior Accounts Payable Specialist.", evidenceQuote: "is hiring a Senior Accounts Payable Specialist", sourceId: sourceIdFor(r.user, NW.hiring.url), eventDate: null, relevance: 0.8, whyItMatters: "x", offerLink: "x" },
        ],
      }),
    });

  it("is never the hook, and holds approval until the rep confirms", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch({ priorities: [layoffs] }), llm()));
    const d = repo.getRunDetail(run.id)!;
    const hook = d.signals.find((s) => s.id === d.hook?.signalId);
    expect(hook?.sensitive).toBeFalsy();
    expect(d.signals.find((s) => /laid off/.test(s.claim))?.sensitive).toBe(true);
    expect(d.limitations.join(" ")).toMatch(/On hold: .*bad news/);

    const blocked = await draftAction(req({ action: "approve", version: 1 }), params(run.id));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).hold).toBe("bad_news");
    expect((await draftAction(req({ action: "approve", version: 1, acknowledgeBadNews: true }), params(run.id))).status).toBe(200);
  });

  it("flags a draft that mentions bad news", () => {
    expect(guard("Sorry to hear about the layoffs last month.")).toContain("mentions_bad_news");
  });
});

describe("5. contact list", () => {
  it("matches emails, domains and company names", () => {
    expect(entryMatches("priya@northwindfreight.com", { email: "Priya@northwindfreight.com" })).toBe(true);
    expect(entryMatches("northwindfreight.com", { website: "https://www.northwindfreight.com/about" })).toBe(true);
    expect(entryMatches("northwindfreight.com", { email: "a@mail.northwindfreight.com" })).toBe(true);
    expect(entryMatches("Northwind Freight", { company: "Northwind Freight Inc." })).toBe(true);
    expect(entryMatches("Northwind Freight", { company: "Harbor Logistics" })).toBe(false);
  });

  it("an opt-out wins over a relationship and can't be overridden", () => {
    const rules = { doNotContact: ["northwindfreight.com"], relationships: [{ match: "Northwind Freight", note: "customer" }] };
    expect(checkContactRules({ company: "Northwind Freight", website: "northwindfreight.com" }, rules, true)?.kind).toBe("do_not_contact");
    expect(checkContactRules({ company: "Northwind Freight" }, { doNotContact: [], relationships: rules.relationships }, true)).toBeNull();
  });

  it("parses 'match: note' lines", () => {
    expect(parseRelationshipLines("acme.com: customer since 2023\nGlobex - open deal\nInitech")).toEqual([
      { match: "acme.com", note: "customer since 2023" },
      { match: "Globex", note: "open deal" },
      { match: "Initech", note: "" },
    ]);
  });

  it("an opt-out stops the run before any search", async () => {
    repo.saveContactRules({ doNotContact: ["northwindfreight.com"], relationships: [] });
    const run = repo.createRun(NORTHWIND);
    const search = northwindSearch();
    await runPipeline(run.id, deps(search, northwindLlm()));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("held");
    expect(d.hold).toMatchObject({ kind: "do_not_contact" });
    expect(search.calls).toHaveLength(0);
    expect((await holdAction(req({}), params(run.id))).status).toBe(409);
  });

  it("a relationship holds the run until the rep chooses to research anyway", async () => {
    repo.saveContactRules({ doNotContact: [], relationships: [{ match: "Northwind Freight", note: "Customer, owner Sam" }] });
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    expect(repo.getRunDetail(run.id)).toMatchObject({ status: "held", hold: { kind: "relationship", note: "Customer, owner Sam" } });
    expect((await holdAction(req({}), params(run.id))).status).toBe(202);
    // The endpoint queued the run itself; wait for that execution rather than starting a second one.
    await vi.waitFor(() => expect(repo.getRun(run.id)?.status).toBe("awaiting_review"));
  });
});

describe("10. fake personalisation (swap test)", () => {
  const hook = signal({});
  it("fails a draft that mentions nothing specific from the hook", () => {
    expect(failsSwapTest("Hi Priya, I noticed Northwind Freight is growing. We help finance teams work faster. Open to a call?", hook, ["Northwind Freight", "Priya Raman"])).toBe(true);
  });
  it("passes a draft that uses the hook's specifics", () => {
    expect(failsSwapTest("Hi Priya, processing 5,000 carrier invoices each month by hand is a lot.", hook, ["Northwind Freight", "Priya Raman"])).toBe(false);
  });
});

describe("11 and 12. overused opener, guess stated as fact", () => {
  it("flags congratulations and mind-reading, not questions", () => {
    expect(guard("Congrats on the Series B!")).toContain("overused_opener");
    expect(guard("I can see you're struggling with your data pipeline.")).toContain("assumption_as_fact");
    expect(guard("Saw you're hiring data engineers. Is that for new pipeline work?")).not.toContain("assumption_as_fact");
  });
});

describe("13. drafts expire during review", () => {
  it("sets an expiry by hook type", () => {
    const at = new Date("2026-11-01T00:00:00Z");
    expect(draftExpiresAt(at, "personalised", "hiring")).toBe("2026-11-15T00:00:00.000Z");
    expect(draftExpiresAt(at, "role_based", null)).toBe("2026-12-16T00:00:00.000Z");
    expect(isExpired("2026-11-15T00:00:00.000Z", new Date("2026-11-16"))).toBe(true);
  });

  it("an expired draft can't be approved", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-01T00:00:00Z"));
    const res = await draftAction(req({ action: "approve", version: 1 }), params(run.id));
    expect(res.status).toBe(409);
    expect((await res.json()).expired).toBe(true);
    expect(repo.getRun(run.id)?.status).toBe("awaiting_review");
  });
});
