import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { applyClarification, runPipeline } from "@/lib/pipeline/runner";
import { deps, FakeLlm, FakeSearch, sourceIdFor } from "../fixtures/fakes";
import { NW, northwindLlm, northwindSearch } from "../fixtures/scenarios";

beforeEach(() => {
  useInMemoryDbForTests();
});

/** Northwind with no person: only the company website was given. */
function companyOnlyLlm(greeting = "Hi there,") {
  return northwindLlm({
    resolve_identity: (r) => ({
      status: "resolved",
      personConfirmed: false,
      employment: "unknown",
      currentCompany: null,
      reasoning: "The website identifies Northwind Freight; no person was specified.",
      resolvedName: null,
      resolvedRole: null,
      resolvedCompany: "Northwind Freight",
      companyDomain: "northwindfreight.com",
      companyDescription: "Digital freight network.",
      evidenceSourceIds: [sourceIdFor(r.user, NW.site)],
      candidates: [],
    }),
    draft: () => ({
      subject: "Cross-border lanes and AP load",
      body: `${greeting}\n\nSaw that Northwind Freight raised a $40M Series B to expand cross-border lanes. New lanes usually mean more carrier invoices landing on finance.\n\nWe automate carrier invoice processing and exceptions, so close holds steady as volume grows.\n\nWould a 20-minute call to compare notes be useful?\n\nAlex`,
      signalIdsUsed: ["G1"],
      recipientHint: "CFO or VP Finance",
    }),
  });
}

describe("runs from a single field", () => {
  it("researches a company from only its website, without inventing a person", async () => {
    const run = repo.createRun({ companyWebsite: "https://northwindfreight.com" });
    const search = northwindSearch();
    const llm = companyOnlyLlm();
    await runPipeline(run.id, deps(search, llm));
    const d = repo.getRunDetail(run.id)!;

    expect(d.status).toBe("awaiting_review");
    expect(d.identity?.resolvedName).toBeNull();
    expect(d.identity?.personConfirmed).toBe(false);
    expect(d.limitations.join(" ")).toMatch(/No specific person was identified/);
    // No interview/podcast search without a person, and person-level findings are rejected.
    expect(search.calls.some((c) => c.query.includes("interview"))).toBe(false);
    expect(d.signals.filter((s) => s.about === "person").every((s) => s.status === "rejected")).toBe(true);
    // The draft prompt forbids inventing a name; the draft records who it's for.
    expect(llm.callsFor("draft")[0].user).toMatch(/never invent a name/);
    expect(d.drafts[0].recipientHint).toBe("CFO or VP Finance");
    expect(d.drafts[0].guard.issues.map((i) => i.code)).not.toContain("invented_name");
  });

  it("flags a greeting that names someone the rep never gave", async () => {
    const run = repo.createRun({ companyWebsite: "https://northwindfreight.com" });
    await runPipeline(run.id, deps(northwindSearch(), companyOnlyLlm("Hi Jordan,")));
    const issue = repo.getRunDetail(run.id)!.drafts[0].guard.issues.find((i) => i.code === "invented_name");
    expect(issue?.excerpt).toBe("Hi Jordan");
  });

  it("asks which company is meant when only an ambiguous company name is given, then resumes", async () => {
    const run = repo.createRun({ company: "Mercury" });
    const pages = {
      bank: { url: "https://mercury.com/about", title: "About Mercury", content: "Mercury is banking for startups, offering business checking and treasury.", rawContent: null, publishedDate: null, score: 1 },
      systems: { url: "https://www.mrcy.com/company", title: "Mercury Systems", content: "Mercury Systems builds secure processing subsystems for aerospace and defense.", rawContent: null, publishedDate: null, score: 1 },
    };
    const search = new FakeSearch((q) => (q.query.includes("official website") ? [pages.bank, pages.systems] : []));
    const llm = new FakeLlm({
      resolve_identity: (r) => ({
        status: "ambiguous",
        personConfirmed: false,
      employment: "unknown",
      currentCompany: null,
        reasoning: "Two different companies are called Mercury.",
        resolvedName: null,
        resolvedRole: null,
        resolvedCompany: null,
        companyDomain: null,
        companyDescription: null,
        evidenceSourceIds: [],
        candidates: [
          { name: "Mercury", role: null, company: "Mercury", description: "Banking for startups", evidenceSourceId: sourceIdFor(r.user, pages.bank.url) },
          { name: "Mercury Systems", role: null, company: "Mercury Systems", description: "Aerospace and defense electronics", evidenceSourceId: sourceIdFor(r.user, pages.systems.url) },
        ],
      }),
    });
    await runPipeline(run.id, deps(search, llm));
    expect(repo.getRunDetail(run.id)!.status).toBe("needs_clarification");

    expect(applyClarification(run.id, { candidateIndex: 1 })).toEqual({ ok: true, mode: "from_research" });
    const d = repo.getRunDetail(run.id)!;
    expect(d.identity?.resolvedCompany).toBe("Mercury Systems");
    expect(d.identity?.resolvedName).toBeNull(); // a company candidate is not a person
    expect(d.identity?.personConfirmed).toBe(false);
  });
});

describe("database upgrade", () => {
  it("adds new draft columns to a database created by an earlier version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-scout-"));
    const file = path.join(dir, "app.db");
    const old = new Database(file);
    old.exec(`CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL, body TEXT NOT NULL, signal_ids_json TEXT NOT NULL, author TEXT NOT NULL, guard_json TEXT NOT NULL, created_at TEXT NOT NULL)`);
    old.close();

    const saved = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    const g = globalThis as typeof globalThis & { __signalScoutDb?: Database.Database };
    g.__signalScoutDb?.close();
    g.__signalScoutDb = undefined;
    try {
      const run = repo.createRun({ company: "Acme" });
      const draft = repo.addDraft(run.id, { kind: "role_based", subject: "s", body: "b", signalIdsUsed: [], author: "ai", guard: { wordCount: 1, issues: [], claims: null, claimCheckNote: null }, recipientHint: "CFO" });
      expect(draft.recipientHint).toBe("CFO");
    } finally {
      (g.__signalScoutDb as Database.Database | undefined)?.close();
      g.__signalScoutDb = undefined;
      if (saved === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
