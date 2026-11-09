import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_SENDER_PROFILE } from "../fixtures/senderProfile";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { runPipeline, setDepsFactory } from "@/lib/pipeline/runner";
import { POST as createRunRoute, GET as listRunsRoute } from "@/app/api/runs/route";
import { POST as draftAction, PUT as editDraft } from "@/app/api/runs/[id]/draft/route";
import { POST as clarify } from "@/app/api/runs/[id]/clarify/route";
import { POST as reviseDraftRoute } from "@/app/api/runs/[id]/draft/revise/route";
import { DELETE as deleteRunRoute } from "@/app/api/runs/[id]/route";
import { POST as uploadDocument } from "@/app/api/documents/route";
import { POST as batchRuns } from "@/app/api/runs/batch/route";
import { deps } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch } from "../fixtures/scenarios";

const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  useInMemoryDbForTests();
  repo.saveSenderProfile(SAMPLE_SENDER_PROFILE); // the app starts empty; these tests need a seller with offerings
  setDepsFactory(() => deps(northwindSearch(), northwindLlm()));
});

describe("POST /api/runs", () => {
  it("returns 400 with field errors and creates no run for invalid input", async () => {
    const res = await createRunRoute(req({ name: "", company: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors._form).toMatch(/at least one field/);
    expect(repo.listRuns()).toHaveLength(0);
  });

  it("returns 400 for malformed JSON", async () => {
    expect((await createRunRoute(req("{not json"))).status).toBe(400);
  });

  it("ignores bodies that aren't sent as JSON, so simple cross-site posts can't start runs (F-08)", async () => {
    const res = await createRunRoute(new Request("http://localhost/api/runs", { method: "POST", body: JSON.stringify({ company: "Acme" }), headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(400);
    expect(repo.listRuns()).toHaveLength(0);
  });

  it("flags a recent duplicate instead of paying for the same research twice, unless forced (S-04)", async () => {
    expect((await createRunRoute(req({ ...NORTHWIND, autoPitch: true }))).status).toBe(202);
    const dup = await createRunRoute(req({ ...NORTHWIND, autoPitch: true }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).duplicate.prospect.name).toBe(NORTHWIND.name);
    expect((await createRunRoute(req({ ...NORTHWIND, force: true, autoPitch: true }))).status).toBe(202);
  });

  it("accepts valid input with 202 and queues the run", async () => {
    const res = await createRunRoute(req({ ...NORTHWIND, autoPitch: true }));
    expect(res.status).toBe(202);
    const { id } = await res.json();
    expect(repo.getRun(id)).not.toBeNull();
    const list = await (await listRunsRoute(new Request("http://localhost/api/runs"))).json();
    expect(list.runs[0].id).toBe(id);
  });
});

describe("choosing what a run pitches", () => {
  it("requires a choice when offerings exist, and refuses unknown or too many offerings", async () => {
    const none = await createRunRoute(req(NORTHWIND));
    expect(none.status).toBe(400);
    expect((await none.json()).fieldErrors.pitch).toMatch(/Choose what you're pitching/);
    expect((await createRunRoute(req({ ...NORTHWIND, offeringIds: ["ghost"] }))).status).toBe(400);
    expect(repo.listRuns()).toHaveLength(0);
  });

  it("snapshots the chosen offerings, so later profile edits don't change the run", async () => {
    const res = await createRunRoute(req({ ...NORTHWIND, offeringIds: ["vendor-onboarding"] }));
    expect(res.status).toBe(202);
    const { id } = await res.json();
    repo.saveSenderProfile({ ...SAMPLE_SENDER_PROFILE, sectors: [] });
    expect(repo.getRun(id)!.pitch).toMatchObject({ mode: "chosen", offerings: [{ id: "vendor-onboarding", sectorName: "AI solutions", name: "Vendor onboarding checks" }] });
  });

  it("needs no choice when no offerings are set up", async () => {
    repo.saveSenderProfile({ ...SAMPLE_SENDER_PROFILE, sectors: [] });
    const res = await createRunRoute(req(NORTHWIND));
    expect(res.status).toBe(202);
    expect(repo.getRun((await res.json()).id)!.pitch).toEqual({ mode: "auto", offerings: [] });
  });
});

describe("draft review endpoints", () => {
  async function readyRun() {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    return run.id;
  }

  it("saves human edits as a new version and re-runs deterministic checks", async () => {
    const id = await readyRun();
    const res = await editDraft(req({ subject: "Edited", body: "Hi Priya, [COMPANY] is great.", baseVersion: 1 }, "PUT"), params(id));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.version).toBe(2);
    expect(draft.author).toBe("human");
    expect(draft.guard.claims).toBeNull();
    expect(draft.guard.issues.map((i: { code: string }) => i.code)).toContain("placeholder");
  });

  it("approves a specific version and never sends; editing after approval requires re-approval", async () => {
    const id = await readyRun();
    expect((await draftAction(req({ action: "approve" }), params(id))).status).toBe(400); // must name the version
    expect((await draftAction(req({ action: "approve", version: 1 }), params(id))).status).toBe(200);
    expect(repo.getRun(id)).toMatchObject({ status: "approved", approvedVersion: 1 });
    await editDraft(req({ subject: "s", body: "b", baseVersion: 1 }, "PUT"), params(id));
    expect(repo.getRun(id)).toMatchObject({ status: "awaiting_review", approvedVersion: null });
  });

  it("refuses to approve or overwrite a version the reviewer hasn't seen (F-09)", async () => {
    const id = await readyRun();
    await editDraft(req({ subject: "Tab B", body: "Saved from another tab", baseVersion: 1 }, "PUT"), params(id)); // now version 2
    const approve = await draftAction(req({ action: "approve", version: 1 }), params(id));
    expect(approve.status).toBe(409);
    expect((await approve.json()).latest.version).toBe(2);
    const staleEdit = await editDraft(req({ subject: "Tab A", body: "Older edit", baseVersion: 1 }, "PUT"), params(id));
    expect(staleEdit.status).toBe(409);
    expect(repo.latestDraft(id)!.subject).toBe("Tab B");
  });

  it("refuses a role-based draft when a real hook exists", async () => {
    const id = await readyRun();
    expect((await draftAction(req({ action: "role_based" }), params(id))).status).toBe(409);
  });

  it("refuses clarification on a run that isn't ambiguous", async () => {
    const id = await readyRun();
    expect((await clarify(req({ candidateIndex: 0 }), params(id))).status).toBe(409);
    expect((await clarify(req({}), params(id))).status).toBe(400);
  });

  it("returns 404 for unknown runs", async () => {
    expect((await draftAction(req({ action: "approve" }), params("nope"))).status).toBe(404);
  });
});

describe("edit with AI (POST /api/runs/[id]/draft/revise)", () => {
  const REVISED = "Hi Priya,\n\nSaw the Series B news about expanding cross-border lanes.\n\nCurious how your team is handling carrier invoices today?\n\nBest,\nSam";

  async function readyRun(revise: (r: { user: string; system: string }) => unknown, checkClaims?: () => unknown) {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    const llm = northwindLlm({ revise_draft: revise, ...(checkClaims ? { check_claims: checkClaims } : {}) });
    setDepsFactory(() => deps(northwindSearch(), llm));
    return { id: run.id, llm };
  }
  const revise = (id: string, instruction: string, baseVersion = 1) => {
    const d = repo.latestDraft(id)!;
    return reviseDraftRoute(req({ instruction, subject: d.subject, body: d.body, baseVersion }), params(id));
  };

  it("saves a rewrite as a new AI version, re-runs the full guard and resets approval", async () => {
    const { id, llm } = await readyRun((r) => {
      expect(r.user).toContain("INSTRUCTION FROM THE REP:\nMake it shorter");
      expect(r.user).toContain("<untrusted_source");
      return { outcome: "revision", reply: "Cut it to four lines.", subject: "Cross-border lanes", body: REVISED, signalIdsUsed: ["G1", "G999"] };
    });
    await draftAction(req({ action: "approve", version: 1 }), params(id));
    const res = await revise(id, "Make it shorter");
    expect(res.status).toBe(200);
    const { draft, changed, reply } = await res.json();
    expect(changed).toBe(true);
    expect(reply).toBe("Cut it to four lines.");
    expect(draft).toMatchObject({ version: 2, author: "ai", body: REVISED, signalIdsUsed: ["G1"] }); // unknown ids dropped
    expect(draft.notes.revision).toMatchObject({ instruction: "Make it shorter", fromVersion: 1 });
    expect(draft.guard.claims).not.toBeNull(); // the claim audit ran, unlike a manual edit
    expect(llm.callsFor("check_claims")[0].user).toContain("Rep's edit instruction: Make it shorter");
    expect(repo.getRun(id)).toMatchObject({ status: "awaiting_review", approvedVersion: null });
  });

  it("answers a question without creating a version", async () => {
    const { id } = await readyRun(() => ({ outcome: "answer", reply: "G1 says they raised a Series B.", subject: "x", body: "y", signalIdsUsed: [] }));
    const res = await revise(id, "What did the funding source say?");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: false, reply: "G1 says they raised a Series B." });
    expect(repo.listDrafts(id)).toHaveLength(1);
  });

  it("flags an unsupported fact the AI introduces instead of hiding it", async () => {
    const { id } = await readyRun(
      () => ({ outcome: "revision", reply: "Added the office.", subject: "Austin", body: REVISED + "\n\nP.S. Congrats on the Austin office.", signalIdsUsed: [] }),
      () => ({ claims: [{ text: "Congrats on the Austin office", kind: "prospect_fact", supportedBy: null }] }),
    );
    const { draft } = await (await revise(id, "Add something about their new office")).json();
    expect(draft.guard.issues.map((i: { code: string }) => i.code)).toContain("unsupported_claim");
    expect(draft.notes.confidence.level).not.toBe("high");
  });

  it("refuses a stale base version and keeps the draft when the model fails", async () => {
    const { id } = await readyRun(() => new Error("model down"));
    expect((await revise(id, "Shorter", 7)).status).toBe(409);
    const failed = await revise(id, "Shorter");
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatch(/wasn't changed/);
    expect(repo.listDrafts(id)).toHaveLength(1);
    expect(repo.getRun(id)!.status).toBe("awaiting_review");
  });

  it("rejects an empty instruction", async () => {
    const { id } = await readyRun(() => ({}));
    expect((await revise(id, "   ")).status).toBe(400);
  });
});

function upload(name: string, content: BlobPart, scope = "prospect") {
  const form = new FormData();
  form.set("file", new File([content], name));
  form.set("scope", scope);
  return uploadDocument(new Request("http://localhost/api/documents", { method: "POST", body: form }));
}

const CSV = "Full Name,Title,Company,Email,Notes\nPriya Raman,VP Finance,Northwind Freight,priya@northwindfreight.com,Met at SaaStr\nDana Whitfield,Owner,Quietbrook Ceramics,dana@gmail.com,\n";

describe("documents and batch runs", () => {
  it("parses an uploaded CSV and maps each row onto prospect fields", async () => {
    const res = await upload("leads.csv", CSV);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document).toMatchObject({ kind: "csv", scope: "prospect", csv: { rowCount: 2 } });
    expect(body.document.text).toBeUndefined(); // text stays on the server
    expect(body.rows[0].prospect).toEqual({ name: "Priya Raman", role: "VP Finance", company: "Northwind Freight", companyWebsite: "northwindfreight.com", notes: "Met at SaaStr", email: "priya@northwindfreight.com" });
    expect(body.rows[1].prospect.companyWebsite).toBeUndefined(); // free-mail domains aren't company websites
  });

  it("rejects files that aren't PDF or CSV, and empty or unreadable files, with clear messages", async () => {
    const exe = await upload("tool.exe", new Uint8Array([0x4d, 0x5a, 0x90]));
    expect(exe.status).toBe(422);
    expect((await exe.json()).error).toMatch(/PDF and CSV/);
    expect((await upload("empty.csv", "")).status).toBe(422);
    expect((await upload("headers.csv", "a,b\n")).status).toBe(422);
  });

  it("starts a run from a CSV row and refuses a CSV attachment without a row", async () => {
    const { document } = await (await upload("leads.csv", CSV)).json();
    const missingRow = await createRunRoute(req({ documents: [{ documentId: document.id }] }));
    expect(missingRow.status).toBe(400);
    const ok = await createRunRoute(req({ name: "Priya Raman", documents: [{ documentId: document.id, rowIndex: 0 }], autoPitch: true }));
    expect(ok.status).toBe(202);
    const run = repo.getRun((await ok.json()).id)!;
    expect(run.documents).toEqual([{ documentId: document.id, name: "leads.csv", kind: "csv", rowIndex: 0 }]);
  });

  it("allows a run with only a document attached", async () => {
    const { document } = await (await upload("leads.csv", CSV)).json();
    expect((await createRunRoute(req({ documents: [{ documentId: document.id, rowIndex: 1 }], autoPitch: true }))).status).toBe(202);
  });

  it("queues at most ten runs from selected rows", async () => {
    const { document } = await (await upload("leads.csv", CSV)).json();
    const res = await batchRuns(req({ documentId: document.id, rowIndexes: [0, 1, 7], offeringIds: ["invoice-agents"] }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.created.map((c: { rowIndex: number }) => c.rowIndex)).toEqual([0, 1]);
    expect(body.skipped).toEqual([7]);
    expect((await batchRuns(req({ documentId: document.id, rowIndexes: Array.from({ length: 11 }, (_, i) => i) }))).status).toBe(400);
  });
});

describe("deleting runs (F-21)", () => {
  it("deletes a finished run and everything it collected, but not one still running", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    expect((await deleteRunRoute(new Request("http://localhost", { method: "DELETE" }), params(run.id))).status).toBe(200);
    expect(repo.getRun(run.id)).toBeNull();
    expect(repo.listSources(run.id)).toEqual([]);
    const busy = repo.createRun({ company: "Acme" });
    expect((await deleteRunRoute(new Request("http://localhost", { method: "DELETE" }), params(busy.id))).status).toBe(409);
  });
});

describe("a new workspace", () => {
  it("starts with an empty sender profile: no example name, company, offerings or call to action", () => {
    useInMemoryDbForTests();
    expect(repo.getSenderProfile()).toEqual({ senderName: "", senderRole: "", companyName: "", companyWebsite: "", defaultCta: "", sectors: [] });
  });
});
