import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { applyClarification, runPipeline } from "@/lib/pipeline/runner";
import { OpenRouterProvider, MAX_REQUESTS_PER_RUN } from "@/lib/providers/openrouter";
import { z } from "zod";
import { deps, FakeLlm, FakeSearch, result, sourceIdFor } from "../fixtures/fakes";
import { AMBIGUOUS, ambiguousLlm, ambiguousSearch, ATLAS, NORTHWIND, northwindLlm, northwindSearch, NW } from "../fixtures/scenarios";

beforeEach(() => {
  useInMemoryDbForTests();
});

const BRIEF = "Account brief for Northwind Freight. Priya Raman (VP Finance) told us on our call that month-end close now takes twelve days and the team is evaluating AP automation before the Mexico launch.";

function docLlm() {
  return northwindLlm({
    resolve_identity: (r) => ({
      status: "resolved",
      personConfirmed: true,
      employment: "current",
      currentCompany: null,
      reasoning: "The rep's brief and the leadership page both name Priya Raman as VP Finance.",
      resolvedName: "Priya Raman",
      resolvedRole: "VP Finance",
      resolvedCompany: "Northwind Freight",
      companyDomain: "northwindfreight.com",
      companyDescription: null,
      evidenceSourceIds: [sourceIdFor(r.user, "upload://brief.pdf")],
      candidates: [],
    }),
    extract_signals: (r) => ({
      signals: [
        {
          type: "challenge",
          about: "person",
          claim: "Priya Raman said month-end close takes twelve days and her team is evaluating AP automation.",
          evidenceQuote: "month-end close now takes twelve days and the team is evaluating AP automation",
          sourceId: sourceIdFor(r.user, "upload://brief.pdf"),
          eventDate: null,
          relevance: 0.95,
          whyItMatters: "A live evaluation is the best possible timing.",
          offerLink: "A live evaluation is the best possible timing.",
        },
      ],
    }),
  });
}

describe("documents as evidence", () => {
  it("researches from an uploaded document alone, verifying its quotes like a web page", async () => {
    const doc = repo.createDocument({ scope: "prospect", name: "brief.pdf", kind: "pdf", text: BRIEF, meta: { pages: 1, csv: null } });
    const run = repo.createRun({}, [{ documentId: doc.id, name: doc.name, kind: "pdf", rowIndex: null }]);
    const llm = docLlm();
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const d = repo.getRunDetail(run.id)!;

    expect(d.status).toBe("awaiting_review");
    const docSource = d.sources.find((s) => s.origin === "prospect_document")!;
    expect(docSource).toMatchObject({ url: "upload://brief.pdf", domain: "your document", reliabilityLabel: "Your document" });
    const hook = d.signals.find((s) => s.id === d.hook?.signalId)!;
    expect(hook.sourceId).toBe(docSource.id); // verified from the document, which never names a domain
    expect(d.events.find((e) => e.stage === "validate" && e.status === "succeeded")?.message).toMatch(/1 document/);
  });

  it("uses only the chosen CSV row as evidence, never the other prospects in the file", async () => {
    const doc = repo.createDocument({
      scope: "prospect",
      name: "leads.csv",
      kind: "csv",
      text: "",
      meta: { pages: null, csv: { headers: ["Name", "Company", "Notes"], rows: [["Priya Raman", "Northwind Freight", "Evaluating AP tools"], ["Linda Raman", "Quietbrook Ceramics", "Row two only: not a fit"]] } },
    });
    const run = repo.createRun({ name: "Priya Raman", company: "Northwind Freight" }, [{ documentId: doc.id, name: doc.name, kind: "csv", rowIndex: 0 }]);
    const llm = northwindLlm();
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const prompt = llm.callsFor("resolve_identity")[0].user;
    expect(prompt).toContain("Evaluating AP tools");
    expect(prompt).not.toContain("Row two only");
  });

  it("gives the drafter the seller's documents and audits sender claims against them", async () => {
    repo.createDocument({ scope: "sender", name: "one-pager.pdf", kind: "pdf", text: "Ledgerline automates carrier invoice matching. Customers like Harbor Logistics cut close from 9 days to 4.", meta: { pages: 1, csv: null } });
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm();
    await runPipeline(run.id, deps(northwindSearch(), llm));
    expect(llm.callsFor("draft")[0].user).toMatch(/SELLER MATERIAL[\s\S]*Harbor Logistics/);
    expect(llm.callsFor("check_claims")[0].user).toContain("Harbor Logistics");
  });
});

describe("structured drafts", () => {
  it("assembles a multi-paragraph draft with a P.S. and keeps reviewer notes", async () => {
    const run = repo.createRun(NORTHWIND);
    const llm = northwindLlm({
      draft: () => ({
        subject: "Cross-border lanes and the AP load behind them",
        alternateSubjects: ["Twelve-day close at Northwind", "Mexico lanes and carrier invoices"],
        greeting: "Hi Priya,",
        opening: "Congratulations on the $40M Series B. Expanding cross-border lanes into Mexico is a big step.",
        insight: "In my experience, new lanes add a layer of carrier invoices and exceptions that lands on finance first.",
        value: "We automate carrier invoice processing and exceptions, so close holds steady as volume grows.",
        cta: "Would a 20-minute call to compare notes be useful?",
        postscript: "You mentioned close stretching to twelve days on the Freight Finance podcast; that's exactly where we help.",
        signoff: "Best,\nAlex",
        signalIdsUsed: ["G1", "G3"],
        recipientHint: null,
        rationale: ["Led with the funding round: fresh and corroborated.", "Saved the podcast quote for the P.S."],
      }),
    });
    await runPipeline(run.id, deps(northwindSearch(), llm));
    const draft = repo.getRunDetail(run.id)!.drafts[0];
    expect(draft.body.split("\n\n")).toHaveLength(7);
    expect(draft.body).toMatch(/^Hi Priya,\n\nCongratulations/);
    expect(draft.body).toMatch(/Best,\nAlex\n\nP\.S\. You mentioned/);
    expect(draft.notes).toMatchObject({
      alternateSubjects: ["Twelve-day close at Northwind", "Mexico lanes and carrier invoices"],
      rationale: ["Led with the funding round: fresh and corroborated.", "Saved the podcast quote for the P.S."],
    });
  });

  it("never offers stale findings as supporting material, and flags recency wording if one is used (F-14)", async () => {
    const run = repo.createRun(NORTHWIND);
    const old = result("https://www.reuters.com/2022/northwind-award", "Northwind wins 2022 logistics award", "Northwind Freight won the 2022 Midwest Logistics Award for carrier onboarding.", "2022-03-01");
    const search = northwindSearch({ priorities: [old] });
    const llm = northwindLlm({
      extract_signals: (r) => ({
        signals: [
          { type: "funding", about: "company", claim: "Northwind Freight raised a $40M Series B.", evidenceQuote: "has raised a $40 million Series B led by Ridgeline Ventures", sourceId: sourceIdFor(r.user, NW.funding.url), eventDate: null, relevance: 0.9, whyItMatters: "x", offerLink: "x" },
          { type: "award", about: "company", claim: "Northwind Freight won the 2022 Midwest Logistics Award.", evidenceQuote: "won the 2022 Midwest Logistics Award", sourceId: sourceIdFor(r.user, old.url), eventDate: "2022", relevance: 0.9, whyItMatters: "x", offerLink: "x" },
        ],
      }),
      draft: () => ({ subject: "Series B", body: "Hi Priya,\n\nCongrats on the Series B and on recently winning the Midwest Logistics Award.\n\nInsight.\n\nValue.\n\nAsk?\n\nAlex", signalIdsUsed: ["G1", "G2"], recipientHint: null }),
    });
    await runPipeline(run.id, deps(search, llm));
    expect(llm.callsFor("draft")[0].user).not.toContain("Midwest Logistics Award");
    expect(repo.getRunDetail(run.id)!.drafts[0].guard.issues.map((i) => i.code)).toContain("stale_as_recent");
  });
});

describe("identity hardening", () => {
  it("after a candidate is picked, drops the other candidates' pages so their facts can't verify (F-02)", async () => {
    const run = repo.createRun(AMBIGUOUS);
    await runPipeline(run.id, deps(ambiguousSearch(), ambiguousLlm()));
    expect(applyClarification(run.id, { candidateIndex: 0 })).toEqual({ ok: true, mode: "from_research" });
    const urls = repo.listSources(run.id).map((s) => s.url);
    expect(urls).toContain(ATLAS.a.url);
    expect(urls).not.toContain(ATLAS.b.url);
    expect(urls).not.toContain(ATLAS.c.url);
    expect(repo.listEvents(run.id).at(-1)?.message).toMatch(/Set aside 2 sources about other matches/);
  });

  it("pauses on a job change instead of pitching the old company, offering the new one (edge case 3)", async () => {
    const run = repo.createRun(NORTHWIND);
    const formerPage = result("https://freightnews.example/people", "People moves", "Priya Raman, former VP Finance at Northwind Freight, has joined Harbor Logistics as CFO.");
    const llm = northwindLlm({
      resolve_identity: (r) => ({
        status: "resolved",
        personConfirmed: true,
        employment: "former",
        currentCompany: "Harbor Logistics",
        reasoning: "A people-moves page says she left.",
        resolvedName: "Priya Raman",
        resolvedRole: "VP Finance",
        resolvedCompany: "Northwind Freight",
        companyDomain: "northwindfreight.com",
        companyDescription: null,
        evidenceSourceIds: [sourceIdFor(r.user, formerPage.url)],
        candidates: [],
      }),
    });
    await runPipeline(run.id, deps(northwindSearch({ identity: [formerPage, NW.team] }), llm));
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("needs_clarification");
    expect(d.identity?.personConfirmed).toBe(false);
    expect(d.identity?.reasoning).toMatch(/job change/i);
    expect(d.identity?.candidates.map((c) => c.company)).toEqual(["Harbor Logistics", "Northwind Freight"]);
    expect(d.drafts).toHaveLength(0); // nothing pitched to the old company
  });

  it("keeps the model's role only when a source states it (S-06)", async () => {
    const run = repo.createRun({ name: "Priya Raman", company: "Northwind Freight", role: "Finance lead", companyWebsite: "https://northwindfreight.com" });
    const llm = northwindLlm({
      resolve_identity: (r) => ({
        status: "resolved",
        personConfirmed: true,
        employment: "current",
        currentCompany: null,
        reasoning: "Leadership page.",
        resolvedName: "Priya Raman",
        resolvedRole: "Chief Financial Officer",
        resolvedCompany: "Northwind Freight",
        companyDomain: "northwindfreight.com",
        companyDescription: null,
        evidenceSourceIds: [sourceIdFor(r.user, NW.team.url)],
        candidates: [],
      }),
    });
    await runPipeline(run.id, deps(northwindSearch(), llm));
    expect(repo.getRun(run.id)!.identity?.resolvedRole).toBe("Finance lead"); // "Chief Financial Officer" appears in no source
  });
});

describe("quota protection (F-13)", () => {
  it("stops after the per-run OpenRouter request budget", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: 502, message: "upstream" } }), { status: 502 });
    };
    const provider = new OpenRouterProvider("sk-or-v1-testkey123456", "m", flaky);
    const request = { task: "draft" as const, system: "s", user: "u", schema: z.object({ a: z.string() }), effort: "low" as const };
    for (let i = 0; i < 10; i++) await provider.generate(request).catch(() => undefined);
    expect(calls).toBe(MAX_REQUESTS_PER_RUN);
  }, 60_000);
});

describe("active time (F-19)", () => {
  it("counts only time the pipeline was working, not time waiting for the rep", async () => {
    const run = repo.createRun(AMBIGUOUS);
    await runPipeline(run.id, deps(ambiguousSearch(), ambiguousLlm()));
    const first = repo.getRun(run.id)!.activeMs;
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(5_000);
    applyClarification(run.id, { candidateIndex: 0 });
    await runPipeline(run.id, deps(ambiguousSearch(), ambiguousLlm()), "from_research");
    expect(repo.getRun(run.id)!.activeMs).toBeGreaterThanOrEqual(first);
  });
});

void FakeLlm;
void FakeSearch;
