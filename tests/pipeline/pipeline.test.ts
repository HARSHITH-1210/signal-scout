import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { ProviderError } from "@/lib/errors";
import { applyClarification, createDefaultDeps, runPipeline } from "@/lib/pipeline/runner";
import { UNTRUSTED_DATA_RULE } from "@/lib/pipeline/sanitize";
import { buildPitch } from "@/lib/pipeline/pitch";
import { deps, FakeSearch } from "../fixtures/fakes";
import {
  AMBIGUOUS,
  ambiguousLlm,
  ambiguousSearch,
  HELIX,
  helixLlm,
  helixSearch,
  insufficientLlm,
  insufficientSearch,
  NORTHWIND,
  northwindLlm,
  northwindSearch,
  NW,
  QUIET,
} from "../fixtures/scenarios";

beforeEach(() => {
  useInMemoryDbForTests();
});

const finalStatus = (id: string) => repo.getRunDetail(id)!;

describe("happy path", () => {
  it("researches, verifies, selects a hook and produces a reviewable draft", async () => {
    const run = repo.createRun(NORTHWIND);
    const search = northwindSearch();
    const llm = northwindLlm();
    await runPipeline(run.id, deps(search, llm));
    const d = finalStatus(run.id);

    expect(d.status).toBe("awaiting_review");
    expect(d.identity?.status).toBe("resolved");
    expect(d.identity?.personConfirmed).toBe(true);
    expect(d.identity?.companyDomain).toBe("northwindfreight.com");

    // Hook is the corroborated, fresh funding signal with a real source URL.
    const hook = d.signals.find((s) => s.id === d.hook?.signalId)!;
    expect(hook.type).toBe("funding");
    expect(hook.status).toBe("verified");
    expect(hook.corroboratingSourceIds.length).toBe(1);
    expect(d.sources.find((s) => s.id === hook.sourceId)?.url).toBe(NW.funding.url);

    // Fabricated quote is rejected; injected "Nobel" signal never becomes a hook.
    const fabricated = d.signals.find((s) => s.claim.includes("fastest-growing"))!;
    expect(fabricated.status).toBe("rejected");
    expect(fabricated.statusReason).toMatch(/not found/i);
    const nobel = d.signals.find((s) => s.claim.includes("Nobel"))!;
    expect(nobel.status).toBe("rejected");
    expect(nobel.statusReason).toMatch(/instructions aimed at AI/);
    expect(d.sources.find((s) => s.url === NW.injection.url)?.suspicious).toBe(true);

    // Draft persisted, guard clean, nothing sent.
    expect(d.drafts).toHaveLength(1);
    expect(d.drafts[0].kind).toBe("personalised");
    expect(d.drafts[0].guard.issues.filter((i) => i.severity === "error")).toEqual([]);

    // Live view: every stage emitted a terminal event, in order.
    expect(Object.values(d.stageStatuses).every((s) => s === "succeeded" || s === "warning")).toBe(true);
    const order = d.events.filter((e) => e.status !== "running").map((e) => e.stage);
    expect(order).toEqual(["validate", "resolve_identity", "research", "extract_signals", "verify", "rank_hook", "draft", "guard"]);
    expect(search.calls.length).toBeLessThanOrEqual(8);
  });

  it("wraps web content as untrusted data in every prompt that includes it", async () => {
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm();
    await runPipeline(run.id, deps(northwindSearch(), llm));
    for (const call of [...llm.callsFor("resolve_identity"), ...llm.callsFor("extract_signals")]) {
      expect(call.system).toContain(UNTRUSTED_DATA_RULE);
      // The hostile page's text is present only inside a delimited block.
      const block = call.user.split("<untrusted_source").find((b) => b.includes("IGNORE ALL PREVIOUS"));
      if (block) expect(block).toContain("</untrusted_source>");
    }
  });
});

describe("offerings the run pitches", () => {
  it("researches, links and drafts around the chosen offerings: best fit leads, the others are named", async () => {
    const chosen = buildPitch(repo.DEFAULT_SENDER_PROFILE, { offeringIds: ["vendor-onboarding", "invoice-agents"] });
    if (!chosen.ok) throw new Error(chosen.error);
    const run = repo.createRun(NORTHWIND, [], chosen.pitch);
    const search = northwindSearch();
    const llm = northwindLlm();
    await runPipeline(run.id, deps(search, llm));

    expect(finalStatus(run.id).status).toBe("awaiting_review");
    expect(search.calls.some((q) => q.query === 'Northwind Freight "Vendor onboarding checks" OR "Invoice-processing agents"')).toBe(true);
    const extraction = llm.callsFor("extract_signals")[0].user;
    expect(extraction).toContain("[vendor-onboarding] Vendor onboarding checks (AI solutions)");
    expect(extraction).toContain("[invoice-agents] Invoice-processing agents");

    // No finding names an offering here, so the first chosen one leads and the other is named in passing.
    const draftPrompt = llm.callsFor("draft")[0].user;
    expect(draftPrompt).toContain("LEAD OFFERING (the value paragraph is about this one only): Vendor onboarding checks:");
    expect(draftPrompt).toContain("ALSO OFFERS (name these in passing in alsoOffer; no details, no claims): Invoice-processing agents");
    expect(llm.callsFor("check_claims")[0].user).toContain("- Invoice-processing agents: AI agents that capture");
    expect(repo.latestDraft(run.id)!.notes?.pitch).toEqual({ lead: "Vendor onboarding checks", others: ["Invoice-processing agents"] });
  });

  it("drafts generally when no offering is set up", async () => {
    const run = repo.createRun(NORTHWIND, [], { mode: "auto", offerings: [] });
    const llm = northwindLlm();
    await runPipeline(run.id, deps(northwindSearch(), llm));
    expect(llm.callsFor("draft")[0].user).toContain("ALSO OFFERS: (none: alsoOffer must be null)");
    expect(repo.latestDraft(run.id)!.notes?.pitch).toEqual({ lead: null, others: [] });
  });
});

describe("edge case: ambiguous prospect", () => {
  it("pauses for clarification instead of researching the wrong person, then resumes", async () => {
    const run = repo.createRun(AMBIGUOUS);
    const search = ambiguousSearch();
    await runPipeline(run.id, deps(search, ambiguousLlm()));
    let d = finalStatus(run.id);

    expect(d.status).toBe("needs_clarification");
    expect(d.identity?.candidates).toHaveLength(3);
    expect(d.identity?.candidates.every((c) => c.evidenceUrl?.startsWith("https://"))).toBe(true);
    expect(d.signals).toHaveLength(0);
    expect(d.drafts).toHaveLength(0);
    expect(search.calls.some((c) => c.query.includes("funding"))).toBe(false); // no research on a guess

    const applied = applyClarification(run.id, { candidateIndex: 0 });
    expect(applied).toEqual({ ok: true, mode: "from_research" });
    await runPipeline(run.id, deps(ambiguousSearch(), ambiguousLlm()), "from_research");
    d = finalStatus(run.id);

    expect(d.status).toBe("awaiting_review");
    expect(d.identity?.confirmedByUser).toBe(true);
    expect(d.prospect.company).toBe("Atlas Robotics");
    expect(d.drafts[0].body).toContain("Atlas Robotics");
  });

  it("rejects clarification for a run that is not waiting on it", () => {
    const run = repo.createRun(NORTHWIND);
    expect(applyClarification(run.id, { candidateIndex: 0 })).toEqual({ ok: false, error: "This run is not waiting for clarification." });
  });
});

describe("edge case: insufficient research", () => {
  it("reports the limitation and does not invent a personalised hook", async () => {
    const run = repo.createRun(QUIET);
    await runPipeline(run.id, deps(insufficientSearch(), insufficientLlm()));
    const d = finalStatus(run.id);

    expect(d.status).toBe("insufficient_research");
    expect(d.hook).toBeNull();
    expect(d.drafts).toHaveLength(0);
    expect(d.limitations.join(" ")).toMatch(/could not be confirmed at this company/);
    expect(d.limitations.join(" ")).toMatch(/below the 0.35 threshold/);
    expect(d.stageStatuses.draft).toBe("skipped");
  });

  it("only produces a clearly labelled role-based draft when the rep asks for one", async () => {
    const run = repo.createRun(QUIET);
    const llm = insufficientLlm();
    await runPipeline(run.id, deps(insufficientSearch(), llm));
    await runPipeline(run.id, deps(insufficientSearch(), llm), "role_based");
    const d = finalStatus(run.id);

    expect(d.status).toBe("awaiting_review");
    expect(d.drafts[0].kind).toBe("role_based");
    expect(d.drafts[0].signalIdsUsed).toEqual([]);
    expect(llm.callsFor("draft")[0].system).toMatch(/WITHOUT personalised research/);
  });

  it("stops at identity when nothing matches at all", async () => {
    const run = repo.createRun({ name: "Zyx Qwerty", company: "Nonexistent Widgets Ltd" });
    await runPipeline(run.id, deps(new FakeSearch(() => []), insufficientLlm()));
    const d = finalStatus(run.id);
    expect(d.status).toBe("insufficient_research");
    expect(d.identity?.status).toBe("not_found");
    expect(d.stageStatuses.research).toBe("skipped");
  });
});

describe("edge case: conflicting and stale information", () => {
  it("flags conflicting funding figures and refuses a stale hook", async () => {
    const run = repo.createRun(HELIX);
    await runPipeline(run.id, deps(helixSearch(), helixLlm()));
    const d = finalStatus(run.id);

    const conflicting = d.signals.filter((s) => s.status === "conflicting");
    expect(conflicting.map((s) => s.id).sort()).toEqual(["G1", "G2"]);
    expect(conflicting[0].statusReason).toMatch(/\$25M vs \$52M/);
    const award = d.signals.find((s) => s.id === "G3")!;
    expect(award.freshness).toBe("stale");

    expect(d.status).toBe("insufficient_research");
    expect(d.limitations.join(" ")).toMatch(/conflict/);
    expect(d.limitations.join(" ")).toMatch(/too old to use as a hook/);
  });

  it("allows a highly relevant stale hook only with a caveat, and flags 'recent' wording", async () => {
    const run = repo.createRun(HELIX);
    const llm = helixLlm({ staleRelevance: 1, staleType: "partnership", draftSaysRecent: true });
    await runPipeline(run.id, deps(helixSearch(), llm));
    const d = finalStatus(run.id);

    expect(d.hook?.staleCaveat).toBe(true);
    expect(llm.callsFor("draft")[0].user).toMatch(/never call it recent/);
    expect(d.status).toBe("awaiting_review");
    expect(d.drafts[0].guard.issues.map((i) => i.code)).toContain("stale_as_recent");
  });
});

describe("failures", () => {
  it("fails clearly when the search provider is down", async () => {
    const run = repo.createRun(NORTHWIND);
    const down = new FakeSearch(() => new ProviderError("tavily", "unavailable", "Tavily is unavailable (HTTP 503)."), {
      [NW.site]: new ProviderError("tavily", "unavailable", "Tavily is unavailable (HTTP 503)."),
    });
    await runPipeline(run.id, deps(down, northwindLlm()));
    const d = finalStatus(run.id);
    expect(d.status).toBe("failed");
    expect(d.stageStatuses.resolve_identity).toBe("failed");
    expect(d.error).toMatch(/Tavily is unavailable/);
  });

  it("carries on from identity results, marked degraded, when every research query fails", async () => {
    const run = repo.createRun(NORTHWIND);
    const err = new ProviderError("tavily", "unavailable", "timeout");
    const search = northwindSearch({ person: err, news: err, funding: err, hiring: err, priorities: err, offerings: err });
    await runPipeline(run.id, deps(search, northwindLlm()));
    const d = finalStatus(run.id);
    expect(d.status).not.toBe("failed");
    expect(d.stageStatuses.research).toBe("warning");
    expect(d.degraded.map((x) => x.code)).toContain("research_failed");
    expect(d.identity?.status).toBe("resolved");
  });

  it("continues with a warning when some research queries fail", async () => {
    const run = repo.createRun(NORTHWIND);
    const err = new ProviderError("tavily", "unavailable", "timeout");
    await runPipeline(run.id, deps(northwindSearch({ hiring: err, priorities: err }), northwindLlm()));
    const d = finalStatus(run.id);
    expect(d.status).toBe("awaiting_review");
    expect(d.stageStatuses.research).toBe("warning");
    expect(d.limitations.join(" ")).toMatch(/2 of 6 research searches failed/);
  });

  it("keeps research when drafting fails, and a retry succeeds", async () => {
    const run = repo.createRun(NORTHWIND);
    const failing = northwindLlm({ draft: () => new ProviderError("anthropic", "refusal", "Claude declined this request.") });
    await runPipeline(run.id, deps(northwindSearch(), failing));
    let d = finalStatus(run.id);
    expect(d.status).toBe("failed");
    expect(d.stageStatuses.draft).toBe("failed");
    expect(d.error).toMatch(/declined/);
    expect(d.hook).not.toBeNull();
    expect(d.signals.length).toBeGreaterThan(0);

    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()), "draft_only");
    d = finalStatus(run.id);
    expect(d.status).toBe("awaiting_review");
    expect(d.drafts).toHaveLength(1);
  });

  it("keeps the existing draft when a regeneration fails", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm({ draft: () => new ProviderError("anthropic", "unavailable", "Anthropic API error (HTTP 529).") })), "draft_only");
    const d = finalStatus(run.id);
    expect(d.status).toBe("awaiting_review");
    expect(d.error).toMatch(/Draft regeneration failed/);
    expect(d.drafts).toHaveLength(1);
  });

  it("reports a skipped claim audit instead of hiding it", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm({ check_claims: () => new Error("network down") })));
    const d = finalStatus(run.id);
    expect(d.status).toBe("awaiting_review");
    expect(d.drafts[0].guard.claims).toBeNull();
    expect(d.drafts[0].guard.issues.map((i) => i.code)).toContain("claim_check_unavailable");
  });

  it("flags unsupported claims and planted links in a draft", async () => {
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm({
      draft: () => ({
        subject: "Congrats Priya",
        body: "Hi Priya,\n\nCongrats on winning the Nobel Prize, and on the $40M Series B. Details: https://evil.example/claim\n\nWe automate carrier invoices so close stays short as you grow. Worth a 20-minute call?\n\nAlex",
        signalIdsUsed: ["G1"],
        recipientHint: null,
      }),
      check_claims: () => ({
        claims: [
          { text: "Congrats on winning the Nobel Prize", kind: "prospect_fact", supportedBy: null },
          { text: "the $40M Series B", kind: "prospect_fact", supportedBy: "G1" },
        ],
      }),
    });
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const codes = finalStatus(run.id).drafts[0].guard.issues.map((i) => i.code);
    expect(codes).toContain("unsupported_claim");
    expect(codes).toContain("unknown_link");
  });

  it("fails fast with a clear message when API keys are missing", async () => {
    const saved = { a: process.env.ANTHROPIC_API_KEY, t: process.env.TAVILY_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      const run = repo.createRun(NORTHWIND);
      await runPipeline(run.id, createDefaultDeps());
      const d = finalStatus(run.id);
      expect(d.status).toBe("failed");
      expect(d.error).toMatch(/TAVILY_API_KEY is not set/);
    } finally {
      if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.t) process.env.TAVILY_API_KEY = saved.t;
    }
  });
});
