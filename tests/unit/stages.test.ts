import { describe, expect, it } from "vitest";
import { applyIdentityChecks } from "@/lib/pipeline/stages/resolveIdentity";
import { planResearchQueries } from "@/lib/pipeline/stages/research";
import { applyReview, groundEventDate, numbersSupported, originKey, verifyDeterministic } from "@/lib/pipeline/stages/verify";
import type { Identity, Signal, Source } from "@/lib/types";

const src = (id: string, url: string, text: string): Source => ({
  id, url, text, title: "t", domain: new URL(url).hostname.replace(/^www\./, ""), publishedDate: null, category: "identity",
  suspicious: false, reliability: 0.7, reliabilityLabel: "General web",
});

const baseOutput = {
  status: "resolved" as const, personConfirmed: true, employment: "current" as const, currentCompany: null, reasoning: "r", resolvedName: "Priya Raman", resolvedRole: "VP Finance",
  resolvedCompany: "Northwind Freight", companyDomain: "northwindfreight.com", companyDescription: null, evidenceSourceIds: ["S1"], candidates: [],
};
const prospect = { name: "Priya Raman", company: "Northwind Freight" };

describe("identity guardrails", () => {
  it("accepts a match backed by a source that names the company and person", () => {
    const sources = [src("S1", "https://northwindfreight.com/team", "Priya Raman, VP Finance at Northwind Freight")];
    const r = applyIdentityChecks(baseOutput, prospect, sources, null, []);
    expect(r.identity.status).toBe("resolved");
    expect(r.identity.personConfirmed).toBe(true);
    expect(r.identity.companyDomain).toBe("northwindfreight.com");
  });

  it("downgrades a 'resolved' claim whose evidence never mentions the company", () => {
    const sources = [src("S1", "https://example.com/a", "Priya Raman is a dentist in Ohio")];
    expect(applyIdentityChecks(baseOutput, prospect, sources, null, []).identity.status).toBe("not_found");
  });

  it("ignores evidence ids that don't exist and domains not seen in sources", () => {
    const sources = [src("S1", "https://northwindfreight.com/team", "Northwind Freight team")];
    const r = applyIdentityChecks({ ...baseOutput, evidenceSourceIds: ["S1", "S99"], companyDomain: "made-up.com" }, prospect, sources, null, []);
    expect(r.identity.evidenceUrls).toEqual(["https://northwindfreight.com/team"]);
    expect(r.identity.companyDomain).toBeNull();
  });

  it("treats a different company than the rep entered as ambiguous", () => {
    const sources = [src("S1", "https://northwind.io/team", "Priya Raman, CFO at Northwind Analytics")];
    const r = applyIdentityChecks({ ...baseOutput, resolvedCompany: "Northwind Analytics" }, { name: "Priya Raman", company: "Southwind Labs" }, sources, null, []);
    expect(r.identity.status).toBe("ambiguous");
    expect(r.identity.candidates[0].company).toBe("Northwind Analytics");
  });

  it("marks the person unconfirmed when no evidence names them", () => {
    const sources = [src("S1", "https://northwindfreight.com/about", "Northwind Freight moves freight")];
    const r = applyIdentityChecks(baseOutput, prospect, sources, null, []);
    expect(r.identity.status).toBe("resolved");
    expect(r.identity.personConfirmed).toBe(false);
    expect(r.limitations[0]).toMatch(/company-level/);
  });
});

describe("research plan", () => {
  it("covers the five signal families and stays within the per-run budget", () => {
    const identity = { resolvedCompany: "Northwind Freight", resolvedName: "Priya Raman", resolvedRole: "VP Finance", companyDomain: "northwindfreight.com" } as Identity;
    const plan = planResearchQueries(identity, prospect, new Date("2026-11-03"));
    expect(plan.map((p) => p.category)).toEqual(["news", "funding", "hiring", "person", "priorities"]);
    expect(plan.find((p) => p.category === "hiring")?.query.query).toContain("finance");
    expect(plan[0].query.startDate).toBe("2025-05-12");
  });
});

describe("consistency", () => {
  const s = (id: string, sourceId: string): Signal => ({
    id, sourceId, type: "funding", about: "company", claim: "c", evidenceQuote: "q", eventDate: null, relevance: 0.8, whyItMatters: "",
    status: "verified", statusReason: null, freshness: "fresh", ageDays: 1, reliability: 0.9, corroboratingSourceIds: [], conflictGroup: null, score: null,
  });
  const sources = [src("S1", "https://a.com/x", "x"), src("S2", "https://b.com/x", "x"), src("S3", "https://a.com/y", "x")];

  it("counts corroboration only across distinct domains and ignores unknown ids", () => {
    const out = applyReview([s("G1", "S1"), s("G2", "S2"), s("G3", "S3")], sources, { support: [], sameFactGroups: [["G1", "G2", "G3", "G404"]], conflicts: [] });
    expect(out[0].corroboratingSourceIds).toEqual(["S2"]);
    expect(out[1].corroboratingSourceIds).toEqual(["S1"]);
  });

  it("marks every member of a conflict group", () => {
    const out = applyReview([s("G1", "S1"), s("G2", "S2")], sources, { support: [], sameFactGroups: [], conflicts: [{ signalIds: ["G1", "G2"], reason: "amounts differ" }] });
    expect(out.every((x: Signal) => x.status === "conflicting" && x.conflictGroup === "C1")).toBe(true);
  });

  it("narrows a claim that overreaches its quote, and rejects one the context doesn't assert (F-04, S-02)", () => {
    const g1 = { ...s("G1", "S1"), claim: "Raised $40M to grow the finance team", evidenceQuote: "raised a $40 million Series B" };
    const g2 = { ...s("G2", "S2"), claim: "Raised $40M", evidenceQuote: "rumours that it raised $40 million" };
    const g3 = { ...s("G3", "S3"), claim: "Raised $90M", evidenceQuote: "raised a $40 million Series B" };
    const out = applyReview([g1, g2, g3], sources, {
      support: [
        { signalId: "G1", quoteAssertsIt: true, claimWithinQuote: false, narrowedClaim: "The company raised a $40 million Series B.", reason: "adds purpose" },
        { signalId: "G2", quoteAssertsIt: false, claimWithinQuote: true, narrowedClaim: null, reason: "only a rumour" },
        { signalId: "G3", quoteAssertsIt: true, claimWithinQuote: false, narrowedClaim: "Raised $90 million.", reason: "wrong number" },
      ],
      sameFactGroups: [],
      conflicts: [],
    });
    expect(out[0]).toMatchObject({ status: "verified", claim: "The company raised a $40 million Series B." });
    expect(out[1].status).toBe("rejected");
    expect(out[1].statusReason).toMatch(/rumour/);
    expect(out[2].status).toBe("rejected"); // the narrowed claim's number still isn't in the quote
  });

  it("doesn't count syndicated copies or the company's own channels as independent (F-11)", () => {
    const story = "Northwind Freight has raised a forty million dollar Series B led by Ridgeline Ventures to expand into Mexico and grow its finance team over the next year.";
    const docs = [src("S1", "https://techcrunch.com/a", story), src("S2", "https://news.yahoo.com/b", story), src("S3", "https://www.businesswire.com/c", "Northwind announces funding"), src("S4", "https://northwindfreight.com/press", "Our Series B")];
    expect(originKey(docs[1], null, docs)).toBe(originKey(docs[0], null, docs));
    expect(originKey(docs[2], "northwindfreight.com", docs)).toBe(originKey(docs[3], "northwindfreight.com", docs));
    const out = applyReview([s("G1", "S1"), s("G2", "S2"), s("G3", "S3"), s("G4", "S4")], docs, { support: [], sameFactGroups: [["G1", "G2", "G3", "G4"]], conflicts: [] }, "northwindfreight.com");
    expect(out[0].corroboratingSourceIds).toEqual(["S3"]); // the reprint and the company's own page add nothing new
  });

  it("only keeps an event date that appears near the quote (F-05)", () => {
    expect(groundEventDate("2026-10-01", "the company announced it in october 2026")).toBe("2026-10-01");
    expect(groundEventDate("2026-10-01", "the company announced its funding")).toBeNull();
    expect(groundEventDate("2026", "a 12026 widget")).toBeNull();
  });

  it("requires every number in a claim to appear in its quote", () => {
    expect(numbersSupported("Raised $40M", "raised a $40 million round")).toBe(true);
    expect(numbersSupported("Processes 5,000+ invoices", "more than 5000 invoices")).toBe(true);
    expect(numbersSupported("Raised $45M", "raised a $40 million round")).toBe(false);
  });
});

describe("identity queries from partial input", () => {
  it("builds searches from whichever field was given", async () => {
    const { identityQueries, linkedinSlugWords } = await import("@/lib/pipeline/stages/resolveIdentity");
    expect(identityQueries({ name: "Priya Raman", company: "Northwind" })[0]).toBe('"Priya Raman" Northwind');
    expect(identityQueries({ company: "Ramp" })).toEqual(["Ramp company official website about"]);
    expect(identityQueries({ companyWebsite: "https://ramp.com" })).toEqual([]); // the website is read directly
    expect(identityQueries({ linkedinUrl: "https://linkedin.com/in/priya-raman-4b2a91" })).toEqual(['"priya raman" linkedin']);
    expect(identityQueries({ role: "CFO", notes: "Austin robotics startup" })).toEqual(["CFO Austin robotics startup"]);
    expect(linkedinSlugWords("https://linkedin.com/in/12345")).toBeNull();
  });

  it("never keeps a model-suggested name the rep didn't give unless a source confirms it", () => {
    const sources = [src("S1", "https://northwindfreight.com/about", "Northwind Freight moves freight across North America")];
    const r = applyIdentityChecks({ ...baseOutput, resolvedName: "Jordan Smith" }, { company: "Northwind Freight" }, sources, null, []);
    expect(r.identity.status).toBe("resolved");
    expect(r.identity.resolvedName).toBeNull();
    expect(r.limitations[0]).toMatch(/No specific person was identified/);
  });
});

describe("live-run regressions", () => {
  it("doesn't reject a claim for stating its year (dates are grounded separately)", () => {
    expect(numbersSupported("Ramp raised $1.85 billion in October 2026", "raised $1.85 billion at a $60 billion valuation")).toBe(true);
    expect(numbersSupported("Ramp raised $2 billion in 2026", "raised $1.85 billion")).toBe(false);
  });

  it("falls back to the quote when a claim's numbers overreach, instead of discarding the finding", () => {
    const sig: Signal = {
      id: "G1", sourceId: "S1", type: "funding", about: "company", eventDate: null, relevance: 0.9, whyItMatters: "", status: "verified", statusReason: null,
      freshness: "fresh", ageDays: 1, reliability: 0.9, corroboratingSourceIds: [], conflictGroup: null, score: null, claim: "Ramp raised a $750 million Series F at a $44 billion valuation.", evidenceQuote: "Raises $750 Million to invest further in AI advancements for customers" };
    const source = src("S1", "https://www.prnewswire.com/ramp", "Ramp Raises $750 Million to invest further in AI advancements for customers. Ramp, the financial operations platform.");
    const identity = { status: "resolved", resolvedName: null, resolvedRole: null, resolvedCompany: "Ramp", companyDomain: "ramp.com", companyDescription: null, reasoning: "", evidenceUrls: [], candidates: [], personConfirmed: false, confirmedByUser: false } as Identity;
    const [out] = verifyDeterministic([sig], [source], identity, { company: "Ramp" }, new Date("2026-11-05"));
    expect(out.status).toBe("verified");
    expect(out.claim).toBe("Raises $750 Million to invest further in AI advancements for customers.");
    expect(out.statusReason).toMatch(/replaced by its quote/);
  });

  it("infers a specific type when a model labels everything 'other'", async () => {
    const { inferSignalType } = await import("@/lib/pipeline/stages/extractSignals");
    expect(inferSignalType("other", "Ramp raised $1.85 billion at a $60 billion valuation")).toBe("funding");
    expect(inferSignalType("other", "Ramp launched Accounts Receivable in September 2026")).toBe("product_launch");
    expect(inferSignalType("other", "Ramp announced a strategic collaboration agreement with AWS")).toBe("partnership");
    expect(inferSignalType("other", "Glyman discussed AI labs as competitors on a podcast")).toBe("interview_or_talk");
    expect(inferSignalType("other", "Ramp was founded in 2019 and is based in New York")).toBe("other");
    expect(inferSignalType("hiring", "anything")).toBe("hiring");
  });
});

describe("source ids after a clarification", () => {
  it("never reuses an id when the kept sources have gaps", async () => {
    const { SourceCollector } = await import("@/lib/pipeline/context");
    const kept = [
      { id: "S1", url: "https://a.com/1" },
      { id: "S2", url: "https://a.com/2" },
      { id: "S5", url: "https://a.com/5" },
    ] as never;
    const collector = new SourceCollector(kept);
    const page = (url: string) => ({ url, title: "t", content: "Northwind Freight is a digital freight network in Chicago.", rawContent: "Northwind Freight is a digital freight network in Chicago.", publishedDate: null, score: 0.5 });
    const ids = ["https://b.com/1", "https://b.com/2", "https://b.com/3"].map((u) => collector.add(page(u), "news", null)?.id);
    expect(ids).toEqual(["S6", "S7", "S8"]);
    expect(new Set(collector.all().map((s) => s.id)).size).toBe(collector.all().length);
  });
});
