import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { ProviderError } from "@/lib/errors";
import { enqueueRun, resumeModeFor, runPipeline, setDepsFactory } from "@/lib/pipeline/runner";
import type { PipelineDeps } from "@/lib/pipeline/context";
import { resolveIdentity } from "@/lib/pipeline/stages/resolveIdentity";
import { findCorroboration } from "@/lib/pipeline/corroborate";
import { pitchOrDefault } from "@/lib/pipeline/pitch";
import { CallRecorder, LlmChain, parseFaults, SearchChain } from "@/lib/providers/chain";
import { isDown, quotaResetAt, recordFailure } from "@/lib/providers/health";
import { preflight } from "@/lib/providers/preflight";
import { checkSendable } from "@/lib/gmail/send";
import { POST as createRunRoute } from "@/app/api/runs/route";
import { POST as resumeRoute } from "@/app/api/runs/[id]/resume/route";
import type { LlmProvider } from "@/lib/providers/llm";
import type { Signal } from "@/lib/types";
import { deps, FakeLlm, FakeSearch, result } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch, NW } from "../fixtures/scenarios";

const REP = "rep@example.com";
const quota = (p: "tavily" | "openrouter") => new ProviderError(p, "quota", `${p} quota used up`);
const down = (p: "tavily" | "openrouter" | "gemini") => new ProviderError(p, "unavailable", `${p} is down`);

/** Real chains wrapped around fixture providers: exercises fallback, logging and the circuit breaker. */
function chainDeps(opts: { primaryLlm: LlmProvider; backupLlm?: LlmProvider; primarySearch: FakeSearch; backupSearch?: FakeSearch }) {
  const recorder = new CallRecorder();
  const llm = new LlmChain(
    [
      { name: "openrouter", model: "free-model", create: () => opts.primaryLlm },
      ...(opts.backupLlm ? [{ name: "gemini" as const, model: "flash", create: () => opts.backupLlm! }] : []),
    ],
    recorder,
  );
  const search = new SearchChain(
    [
      { name: "tavily", create: () => opts.primarySearch },
      ...(opts.backupSearch ? [{ name: "exa" as const, create: () => opts.backupSearch! }] : []),
    ],
    [
      { name: "tavily", create: () => opts.primarySearch },
      ...(opts.backupSearch ? [{ name: "exa" as const, create: () => opts.backupSearch! }] : []),
    ],
    recorder,
  );
  return { search, llm, now: deps(opts.primarySearch, opts.primaryLlm).now, recorder } satisfies PipelineDeps;
}

const alwaysFail = (error: Error) => new FakeSearch(() => error, { [NW.site]: error });
const llmThatFails = (error: Error) =>
  new FakeLlm({ resolve_identity: () => error, extract_signals: () => error, find_conflicts: () => error, draft: () => error, check_claims: () => error });

beforeEach(() => {
  useInMemoryDbForTests();
  setDepsFactory(() => deps(northwindSearch(), northwindLlm()));
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_PROVIDER;
});
afterEach(() => vi.useRealTimers());

describe("LLM fallback chain", () => {
  it("falls over to the backup provider on quota, logs it, and marks the run degraded", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, chainDeps({ primaryLlm: llmThatFails(quota("openrouter")), backupLlm: northwindLlm(), primarySearch: northwindSearch() }));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("awaiting_review");
    expect(d.degraded.map((x) => x.code)).toContain("llm_fallback");
    const served = d.providerCalls.filter((c) => c.outcome === "ok" && c.provider === "gemini");
    expect(served.length).toBeGreaterThan(0);
    expect(served[0].fallbackFrom).toBe("openrouter");
    // The quota error opened the circuit until the next UTC midnight: later calls skip it without trying.
    expect(isDown("openrouter").down).toBe(true);
    expect(d.providerCalls.filter((c) => c.provider === "openrouter" && c.outcome === "error")).toHaveLength(1);
    expect(d.providerCalls.some((c) => c.provider === "openrouter" && c.outcome === "skipped")).toBe(true);
  });

  it("fails clearly, with every provider's reason, when all of them fail", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, chainDeps({ primaryLlm: llmThatFails(down("openrouter")), backupLlm: llmThatFails(down("gemini")), primarySearch: northwindSearch() }));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/openrouter: openrouter is down · gemini: gemini is down/);
  });

  it("sends an independent check to a different provider than the one that did the work", async () => {
    const a = new FakeLlm({ draft: () => ({ ok: "a" }), check_claims: () => ({ ok: "a" }) });
    const b = new FakeLlm({ draft: () => ({ ok: "b" }), check_claims: () => ({ ok: "b" }) });
    const chain = new LlmChain([{ name: "openrouter", create: () => a }, { name: "gemini", create: () => b }], new CallRecorder());
    const schema = z.object({ ok: z.string() });
    expect(await chain.generate({ task: "draft", system: "", user: "", effort: "low", schema })).toEqual({ ok: "a" });
    expect(await chain.generate({ task: "check_claims", system: "", user: "", effort: "low", schema, independentOf: "draft" })).toEqual({ ok: "b" });
  });

  it("reports a missing key, not a vague failure, when no provider is set up", async () => {
    const chain = new LlmChain(
      [{ name: "openrouter", create: () => { throw new ProviderError("openrouter", "config", "OPENROUTER_API_KEY is not set."); } }],
      new CallRecorder(),
    );
    await expect(chain.generate({ task: "draft", system: "", user: "", effort: "low", schema: z.object({}) })).rejects.toThrow(/OPENROUTER_API_KEY is not set/);
  });
});

describe("search fallback chain and degrade-not-fail", () => {
  it("uses the backup search when Tavily is out of quota", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, chainDeps({ primaryLlm: northwindLlm(), primarySearch: alwaysFail(quota("tavily")), backupSearch: northwindSearch() }));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("awaiting_review");
    expect(d.degraded.map((x) => x.code)).toEqual(expect.arrayContaining(["search_fallback"]));
    expect(d.providerCalls.some((c) => c.provider === "exa" && c.outcome === "ok")).toBe(true);
  });

  it("says it couldn't search (a failure you can resume), not that it found nothing", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, chainDeps({ primaryLlm: northwindLlm(), primarySearch: alwaysFail(down("tavily")) }));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/Couldn't search the web/);
    expect(resumeModeFor(run.id)).toMatchObject({ ok: true, mode: "from_identity" });
  });

  it("identifies the prospect from documents when web search is down", async () => {
    const degraded: string[] = [];
    const llm = new FakeLlm({
      resolve_identity: () => ({
        status: "not_found", personConfirmed: false, employment: "unknown", currentCompany: null, reasoning: "r", resolvedName: null, resolvedRole: null,
        resolvedCompany: null, companyDomain: null, companyDescription: null, evidenceSourceIds: [], candidates: [],
      }),
    });
    const ctx = { runId: "r", deps: deps(alwaysFail(down("tavily")), llm), sender: repo.getSenderProfile(), pitch: pitchOrDefault(null, repo.getSenderProfile()), emit: () => undefined, degrade: (code: string) => degraded.push(code) };
    await expect(resolveIdentity(ctx, { company: "Northwind Freight" }, [{ name: "brief.pdf", text: "Northwind Freight account brief." }])).resolves.toBeDefined();
    expect(degraded).toContain("documents_only");
  });

  it("keeps quote-verified findings when the AI review fails, and caps confidence", async () => {
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm({ find_conflicts: () => down("openrouter") });
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("awaiting_review");
    expect(d.degraded.map((x) => x.code)).toContain("model_review_skipped");
    expect(d.drafts[0].notes?.confidence?.level).not.toBe("high");
  });
});

describe("resume, deadline and send gate", () => {
  it("resumes from extraction without repeating any search", async () => {
    const run = repo.createRun(NORTHWIND);
    const search = northwindSearch();
    await runPipeline(run.id, deps(search, northwindLlm({ extract_signals: () => down("openrouter") })));
    expect(repo.getRun(run.id)).toMatchObject({ status: "failed", currentStage: "extract_signals" });
    const searchesBefore = search.calls.length;

    const plan = resumeModeFor(run.id);
    expect(plan).toMatchObject({ ok: true, mode: "from_extract" });
    await runPipeline(run.id, deps(search, northwindLlm()), plan.ok ? plan.mode : "full");
    expect(repo.getRun(run.id)?.status).toBe("awaiting_review");
    expect(search.calls.length).toBe(searchesBefore);
  });

  it("the resume endpoint only accepts failed runs", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    const res = await resumeRoute(new Request("http://localhost/api", { method: "POST" }), { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(409);
  });

  it("stops at the next stage once the run passes its time limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    const run = repo.createRun(NORTHWIND);
    const inner = northwindSearch();
    // Research is very slow: by the time it ends, the run is past its 20 minutes.
    const slow = new FakeSearch((q) => {
      if (!/"priya raman"/i.test(q.query) || /interview/i.test(q.query)) vi.setSystemTime(new Date("2026-11-05T10:25:00Z"));
      return (inner as unknown as { handler: (q: unknown) => never }).handler(q);
    }, { [NW.site]: "Northwind Freight is a digital freight network." });
    await runPipeline(run.id, deps(slow, northwindLlm()));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/20-minute time limit/);
  });

  it("won't send a draft whose claim audit didn't run until the rep confirms the facts", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-secret-value";
    try {
      repo.saveGmailConnection({ email: "rep@example.com", refreshToken: "1//r", accessToken: "ya29.x", accessTokenExpiresAt: Date.now() + 3_600_000, connectedAt: "", autoSendOnApprove: true });
      const run = repo.createRun({ ...NORTHWIND, email: "priya@example.com" });
      await runPipeline(run.id, deps(northwindSearch(), northwindLlm({ check_claims: () => down("openrouter") })));
      const d = repo.getRunDetail(run.id)!;
      expect(d.drafts[0].guard.issues.map((i) => i.code)).toContain("claim_check_unavailable");
      expect(checkSendable(REP, run.id, 1, undefined)).toMatchObject({ ok: false, unaudited: true });
      const errors = d.drafts[0].guard.issues.filter((i) => i.severity === "error");
      if (errors.length === 0) expect(checkSendable(REP, run.id, 1, undefined, { acknowledgeUnaudited: true }).ok).toBe(true);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });
});

describe("circuit breaker and preflight", () => {
  it("knows when each provider's quota comes back", () => {
    const now = new Date("2026-11-05T15:00:00Z");
    expect(quotaResetAt("openrouter", now).toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(quotaResetAt("gemini", now).toISOString()).toBe("2026-11-06T08:00:00.000Z");
    expect(quotaResetAt("tavily", now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("pauses a provider only after three outages in a row", () => {
    recordFailure("gemini", down("gemini"));
    recordFailure("gemini", down("gemini"));
    expect(isDown("gemini").down).toBe(false);
    recordFailure("gemini", down("gemini"));
    expect(isDown("gemini").down).toBe(true);
  });

  it("refuses to start a run when every AI provider is paused, and holds the queue", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.LLM_PROVIDER = "openrouter";
    recordFailure("openrouter", quota("openrouter"));
    expect(preflight()).toMatchObject({ ok: false });
    const res = await createRunRoute(new Request("http://localhost/api/runs", { method: "POST", body: JSON.stringify({ ...NORTHWIND, autoPitch: true }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/No AI provider is available/);

    const run = repo.createRun(NORTHWIND);
    enqueueRun(run.id);
    expect(repo.getRun(run.id)?.status).toBe("queued");
    expect(repo.listEvents(run.id).at(-1)?.message).toMatch(/^Waiting:/);
  });

  it("parses the demo fault switch", () => {
    const faults = parseFaults("tavily:quota, openrouter:down,bogus:x");
    expect([...faults.entries()]).toEqual([
      ["tavily", "quota"],
      ["openrouter", "unavailable"],
    ]);
  });
});

describe("cross-verification", () => {
  const hook = {
    id: "G1", type: "funding", about: "company", claim: "Northwind Freight raised a $40 million Series B led by Ridgeline Ventures.",
    evidenceQuote: "has raised a $40 million Series B led by Ridgeline Ventures", sourceId: "S1", corroboratingSourceIds: [],
  } as unknown as Signal;
  const backing = [{ id: "S1", domain: "techcrunch.com" }] as never;

  it("counts an independent page that restates the fact, word for word", () => {
    const agree = result("https://www.reuters.com/x", "Northwind Freight funding", "Northwind Freight closed a $40 million Series B led by Ridgeline Ventures this week.");
    const unrelated = result("https://blog.example/y", "Freight trends", "Northwind Freight is a digital freight network in Chicago.");
    const sameDomain = result("https://techcrunch.com/z", "Again", "Northwind Freight raised a $40 million Series B led by Ridgeline Ventures.");
    const found = findCorroboration(hook, [agree, unrelated, sameDomain], backing, "Northwind Freight", "northwindfreight.com", ["Northwind Freight"]);
    expect(found.map((r) => r.url)).toEqual(["https://www.reuters.com/x"]);
  });

  it("asks a second provider when a match rests on one source, and pauses if they disagree", async () => {
    const identityOutput = (company: string) => ({
      status: "resolved", personConfirmed: true, employment: "current", currentCompany: null, reasoning: "r", resolvedName: "Priya Raman", resolvedRole: "VP Finance",
      resolvedCompany: company, companyDomain: null, companyDescription: null, evidenceSourceIds: ["S1"], candidates: [],
    });
    const run = repo.createRun({ name: "Priya Raman" });
    const one = result("https://example.org/people", "People", "Priya Raman is VP Finance at Northwind Freight. Priya Raman also advises Harbor Logistics.");
    const search = new FakeSearch(() => [one]);
    await runPipeline(
      run.id,
      chainDeps({
        primaryLlm: new FakeLlm({ resolve_identity: () => identityOutput("Northwind Freight") }),
        backupLlm: new FakeLlm({ resolve_identity: () => identityOutput("Harbor Logistics") }),
        primarySearch: search,
      }),
    );
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("needs_clarification");
    expect(d.identity?.reasoning).toMatch(/Two AI providers disagreed/);
    expect(d.identity?.candidates.map((c) => c.company)).toEqual(["Northwind Freight", "Harbor Logistics"]);
  });
});
