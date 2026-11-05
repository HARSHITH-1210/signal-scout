import { describe, expect, it } from "vitest";
import { allOfferings, buildPitch, documentsForPitch, pitchFocus, upgradeSenderProfile } from "@/lib/pipeline/pitch";
import type { Offering, RunPitch, SenderProfile, Signal } from "@/lib/types";

const offering = (id: string, documentIds: string[] = []): Offering => ({ id, name: id.toUpperCase(), whatItDoes: `${id} does things`, cta: "", documentIds });
const profile: SenderProfile = {
  senderName: "Sam",
  senderRole: "AE",
  companyName: "Ledgerline",
  companyWebsite: "",
  defaultCta: "a call",
  sectors: [
    { id: "ai", name: "AI solutions", offerings: [offering("agents", ["d1"]), offering("onboarding", ["d2"])] },
    { id: "data", name: "Data", offerings: [offering("dashboards")] },
  ],
};
const signal = (id: string, offeringId: string | null, o: Partial<Signal> = {}): Signal => ({
  id, type: "hiring", about: "company", claim: "c", evidenceQuote: "q", sourceId: "S1", eventDate: null, relevance: 0.8, whyItMatters: "w",
  status: "verified", statusReason: null, freshness: "fresh", ageDays: 5, reliability: 0.9, corroboratingSourceIds: [], conflictGroup: null, score: null, offeringId, ...o,
});

describe("upgradeSenderProfile", () => {
  it("turns a version-1 profile into a General sector without losing text", () => {
    const v1 = { senderName: "Sam", senderRole: "AE", companyName: "Ledgerline", companyWebsite: "", offering: "We automate AP.", valueProp: "Close faster.", callToAction: "A call" };
    const up = upgradeSenderProfile(v1, profile);
    expect(up.defaultCta).toBe("A call");
    expect(up.sectors).toEqual([{ id: "general", name: "General", offerings: [{ id: "main", name: "Ledgerline", whatItDoes: "We automate AP. Close faster.", cta: "", documentIds: [] }] }]);
    expect(upgradeSenderProfile({ ...v1, offering: "", valueProp: "" }, profile).sectors).toEqual([]);
    expect(upgradeSenderProfile(profile, profile)).toEqual(profile);
    // A saved offering that still has a value proposition keeps its text, folded into "what it does".
    const legacy = { ...profile, sectors: [{ id: "ai", name: "AI", offerings: [{ ...offering("agents"), valueProp: "Saves time." }] }] };
    expect(upgradeSenderProfile(legacy, profile).sectors[0].offerings[0]).toEqual({ ...offering("agents"), whatItDoes: "agents does things Saves time." });
  });
});

describe("buildPitch", () => {
  it("snapshots chosen offerings with their sector, in the rep's order", () => {
    const r = buildPitch(profile, { offeringIds: ["dashboards", "agents", "agents"] });
    expect(r.ok && r.pitch.mode).toBe("chosen");
    if (r.ok) expect(r.pitch.offerings.map((o) => `${o.sectorName}/${o.id}`)).toEqual(["Data/dashboards", "AI solutions/agents"]);
  });

  it("requires a choice, refuses unknown ids and too many, and allows auto", () => {
    expect(buildPitch(profile, {}).ok).toBe(false);
    expect(buildPitch(profile, { offeringIds: ["nope"] }).ok).toBe(false);
    expect(buildPitch(profile, { offeringIds: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(false);
    const auto = buildPitch(profile, { auto: true });
    expect(auto.ok && auto.pitch).toMatchObject({ mode: "auto", offerings: allOfferings(profile) });
    expect(buildPitch({ ...profile, sectors: [] }, {})).toEqual({ ok: true, pitch: { mode: "auto", offerings: [] } });
  });
});

describe("pitchFocus", () => {
  const chosen: RunPitch = { mode: "chosen", offerings: allOfferings(profile) };

  it("leads with the hook's offering and names every other chosen one", () => {
    const f = pitchFocus(chosen, signal("G1", "onboarding"), [signal("G1", "onboarding"), signal("G2", "agents")]);
    expect(f.lead?.id).toBe("onboarding");
    expect(f.others.map((o) => o.id)).toEqual(["agents", "dashboards"]);
  });

  it("falls back to the most-linked offering, then the first", () => {
    expect(pitchFocus(chosen, signal("G1", null), [signal("G2", "dashboards"), signal("G3", "dashboards"), signal("G4", "agents")]).lead?.id).toBe("dashboards");
    expect(pitchFocus(chosen, undefined, []).lead?.id).toBe("agents");
  });

  it("ignores links from unverified or bad-news findings and ids that weren't pitched", () => {
    const f = pitchFocus(chosen, undefined, [signal("G1", "dashboards", { status: "rejected" }), signal("G2", "onboarding", { sensitive: true }), signal("G3", "ghost")]);
    expect(f.lead?.id).toBe("agents");
  });

  it("in auto mode names only other offerings the research linked, at most two", () => {
    const auto: RunPitch = { mode: "auto", offerings: allOfferings(profile) };
    const f = pitchFocus(auto, signal("G1", "agents"), [signal("G1", "agents"), signal("G2", "dashboards")]);
    expect(f.lead?.id).toBe("agents");
    expect(f.others.map((o) => o.id)).toEqual(["dashboards"]);
    expect(pitchFocus({ mode: "auto", offerings: [] }, undefined, [])).toEqual({ lead: null, others: [] });
  });
});

describe("documentsForPitch", () => {
  it("keeps company-wide documents and those of pitched offerings only", () => {
    const docs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
    const pitch: RunPitch = { mode: "chosen", offerings: allOfferings(profile).filter((o) => o.id === "agents") };
    expect(documentsForPitch(docs, profile, pitch).map((d) => d.id)).toEqual(["d1", "d3"]);
  });
});

describe("drafting and extraction with offerings", () => {
  it("puts the also-offers sentence right after the value paragraph", async () => {
    const { assembleBody } = await import("@/lib/pipeline/stages/draft");
    const body = assembleBody({ greeting: "Hi Priya,", opening: "O.", insight: "I.", value: "V.", alsoOffer: "We also help with X.", cta: "C?", postscript: null, signoff: "Best,\nSam" });
    expect(body).toBe("Hi Priya,\n\nO.\n\nI.\n\nV. We also help with X.\n\nC?\n\nBest,\nSam");
  });

  it("keeps only offering ids that were pitched, and links the sole offering by default", async () => {
    const { extractSignals } = await import("@/lib/pipeline/stages/extractSignals");
    const { FakeLlm, FakeSearch, deps } = await import("../fixtures/fakes");
    const base = { type: "hiring", about: "company", claim: "Hiring AP clerks", evidenceQuote: "hiring three AP clerks", sourceId: "S1", eventDate: null, relevance: 0.8, whyItMatters: "w" };
    const llm = new FakeLlm({
      extract_signals: () => ({
        signals: [
          { ...base, offerLink: "AP load", offeringId: "agents" },
          { ...base, offerLink: "AP load", offeringId: "ghost" },
          { ...base, offerLink: null, offeringId: "agents" },
        ],
      }),
    });
    const source = { id: "S1", url: "https://example.com/jobs", title: "Jobs", domain: "example.com", publishedDate: null, category: "hiring" as const, text: "We are hiring three AP clerks.", suspicious: false, reliability: 0.7, reliabilityLabel: "General web" };
    const identity = { status: "resolved" as const, resolvedName: null, resolvedRole: null, resolvedCompany: "Acme", companyDomain: null, companyDescription: null, reasoning: "", evidenceUrls: [], candidates: [], personConfirmed: false, confirmedByUser: false };
    const ctx = (pitch: RunPitch) => ({ runId: "r", deps: deps(new FakeSearch(() => []), llm), sender: profile, pitch, emit: () => {} });

    const two = await extractSignals(ctx({ mode: "chosen", offerings: allOfferings(profile).slice(0, 2) }), { company: "Acme" }, identity, [source]);
    expect(two.map((s) => s.offeringId)).toEqual(["agents", null, null]);
    expect(two[2].relevance).toBeLessThanOrEqual(0.3); // no link to any offering: capped below the hook threshold

    const one = await extractSignals(ctx({ mode: "chosen", offerings: allOfferings(profile).slice(2) }), { company: "Acme" }, identity, [source]);
    expect(one.map((s) => s.offeringId)).toEqual(["dashboards", "dashboards", null]);
  });
});
