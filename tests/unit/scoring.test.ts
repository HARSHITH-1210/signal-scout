import { describe, expect, it } from "vitest";
import { assessFreshness, parseLooseDate } from "@/lib/pipeline/freshness";
import { HOOK_THRESHOLD, scoreSignal, selectHook } from "@/lib/pipeline/scoring";
import { assessReliability, domainOf } from "@/lib/pipeline/sourceReliability";
import type { Signal } from "@/lib/types";

const now = new Date("2026-11-03T00:00:00Z");

describe("freshness", () => {
  it.each([
    ["2026-10-01", "fresh"],
    ["2026-03-01", "aging"],
    ["2024-01-15", "stale"],
    ["2026-04", "aging"],
    [null, "unknown"],
    ["not a date", "unknown"],
    ["2027-06-01", "unknown"], // future dates aren't trusted
  ])("%s -> %s", (date, expected) => {
    expect(assessFreshness(date, null, now).freshness).toBe(expected);
  });

  it("prefers the event date over the publish date", () => {
    expect(assessFreshness("2023-01-01", "2026-10-30", now).freshness).toBe("stale");
    expect(assessFreshness(null, "2026-10-30", now).freshness).toBe("fresh");
  });

  it("parses year-only and year-month dates", () => {
    expect(parseLooseDate("2025")?.getUTCFullYear()).toBe(2025);
    expect(parseLooseDate("2025-03")?.getUTCMonth()).toBe(2);
  });
});

describe("source reliability", () => {
  it("tiers domains", () => {
    expect(assessReliability("northwindfreight.com", "northwindfreight.com").score).toBe(1);
    expect(assessReliability("careers.northwindfreight.com", "northwindfreight.com").score).toBe(1);
    expect(assessReliability("techcrunch.com", null).score).toBe(0.9);
    expect(assessReliability("boards.greenhouse.io", null).score).toBe(0.85);
    expect(assessReliability("zoominfo.com", null).score).toBeLessThan(0.5);
    expect(assessReliability("someblog.net", null).label).toBe("General web");
  });

  it("extracts domains safely", () => {
    expect(domainOf("https://www.Reuters.com/a/b")).toBe("reuters.com");
    expect(domainOf("nonsense")).toBe("");
  });
});

function signal(overrides: Partial<Signal>): Signal {
  return {
    id: "G1", type: "strategic_priority", about: "company", claim: "c", evidenceQuote: "q", sourceId: "S1", eventDate: null,
    relevance: 0.8, whyItMatters: "w", status: "verified", statusReason: null, freshness: "fresh", ageDays: 10,
    reliability: 0.9, corroboratingSourceIds: [], conflictGroup: null, score: null, ...overrides,
  };
}

describe("scoring and hook selection", () => {
  it("multiplies relevance, freshness and reliability with a capped corroboration bonus", () => {
    expect(scoreSignal(signal({}))).toBe(0.72);
    expect(scoreSignal(signal({ corroboratingSourceIds: ["S2"] }))).toBe(0.828);
    expect(scoreSignal(signal({ corroboratingSourceIds: ["S2", "S3", "S4"] }))).toBe(scoreSignal(signal({ corroboratingSourceIds: ["S2", "S3"] })));
    expect(scoreSignal(signal({ freshness: "stale" }))).toBeCloseTo(0.288);
  });

  it("never selects rejected or conflicting signals", () => {
    const { hook } = selectHook([
      signal({ id: "G1", status: "conflicting", relevance: 1 }),
      signal({ id: "G2", status: "rejected", relevance: 1 }),
      signal({ id: "G3", relevance: 0.6 }),
    ]);
    expect(hook?.signalId).toBe("G3");
  });

  it("returns reasons instead of a hook when nothing clears the threshold", () => {
    const result = selectHook([signal({ relevance: 0.2 }), signal({ id: "G2", status: "rejected" })]);
    expect(result.hook).toBeNull();
    expect(result.reasons.join(" ")).toContain(String(HOOK_THRESHOLD));
    expect(result.reasons.join(" ")).toMatch(/rejected/);
  });

  it("explains an empty result", () => {
    expect(selectHook([]).reasons[0]).toMatch(/No usable findings/);
  });

  it("always gives a reason, even when every finding conflicts", () => {
    expect(selectHook([signal({ status: "conflicting" })]).reasons).toEqual(["No verified, uncontested finding was available to build a hook on."]);
  });

  it("marks a stale hook with a caveat", () => {
    const { hook } = selectHook([signal({ freshness: "stale", relevance: 1, reliability: 1 })]);
    expect(hook?.staleCaveat).toBe(true);
  });
});

describe("recency by signal type (edge case 7)", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("a 5-month-old job post is stale while a 5-month-old funding round is still fresh", () => {
    expect(assessFreshness("2026-06-01", null, now, "hiring").freshness).toBe("stale");
    expect(assessFreshness("2026-06-01", null, now, "funding").freshness).toBe("fresh");
  });
  it("undated items stay unknown and weak", () => {
    expect(assessFreshness(null, null, now, "funding").freshness).toBe("unknown");
  });
});

describe("bad news and overused hooks (edge cases 4 and 11)", () => {
  it("never picks bad news as the hook, however strong", () => {
    const bad = signal({ id: "G1", relevance: 1, reliability: 1, sensitive: true });
    const ok = signal({ id: "G2", relevance: 0.7 });
    expect(selectHook([bad, ok]).hook?.signalId).toBe("G2");
    const none = selectHook([bad]);
    expect(none.hook).toBeNull();
    expect(none.reasons.join(" ")).toMatch(/bad news/);
  });

  it("prefers a less obvious finding of similar quality over a funding round", () => {
    const funding = signal({ id: "G1", type: "funding", relevance: 0.8 });
    const hiring = signal({ id: "G2", type: "hiring", relevance: 0.75 });
    expect(selectHook([funding, hiring]).hook?.signalId).toBe("G2");
  });

  it("detects layoffs, breaches and lawsuits", async () => {
    const { isSensitive } = await import("@/lib/pipeline/sensitive");
    expect(isSensitive("Northwind laid off 120 employees")).toBe(true);
    expect(isSensitive("A data breach exposed customer records")).toBe(true);
    expect(isSensitive("The company was sued by a former partner")).toBe(true);
    expect(isSensitive("Northwind raised a $40M Series B")).toBe(false);
  });
});
