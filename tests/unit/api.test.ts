import { beforeEach, describe, expect, it } from "vitest";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { runPipeline, setDepsFactory } from "@/lib/pipeline/runner";
import { POST as createRunRoute, GET as listRunsRoute } from "@/app/api/runs/route";
import { POST as draftAction, PUT as editDraft } from "@/app/api/runs/[id]/draft/route";
import { POST as clarify } from "@/app/api/runs/[id]/clarify/route";
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
    expect((await createRunRoute(req(NORTHWIND))).status).toBe(202);
    const dup = await createRunRoute(req(NORTHWIND));
    expect(dup.status).toBe(409);
    expect((await dup.json()).duplicate.prospect.name).toBe(NORTHWIND.name);
    expect((await createRunRoute(req({ ...NORTHWIND, force: true }))).status).toBe(202);
  });

  it("accepts valid input with 202 and queues the run", async () => {
    const res = await createRunRoute(req(NORTHWIND));
    expect(res.status).toBe(202);
    const { id } = await res.json();
    expect(repo.getRun(id)).not.toBeNull();
    const list = await (await listRunsRoute(new Request("http://localhost/api/runs"))).json();
    expect(list.runs[0].id).toBe(id);
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
    const ok = await createRunRoute(req({ name: "Priya Raman", documents: [{ documentId: document.id, rowIndex: 0 }] }));
    expect(ok.status).toBe(202);
    const run = repo.getRun((await ok.json()).id)!;
    expect(run.documents).toEqual([{ documentId: document.id, name: "leads.csv", kind: "csv", rowIndex: 0 }]);
  });

  it("allows a run with only a document attached", async () => {
    const { document } = await (await upload("leads.csv", CSV)).json();
    expect((await createRunRoute(req({ documents: [{ documentId: document.id, rowIndex: 1 }] }))).status).toBe(202);
  });

  it("queues at most ten runs from selected rows", async () => {
    const { document } = await (await upload("leads.csv", CSV)).json();
    const res = await batchRuns(req({ documentId: document.id, rowIndexes: [0, 1, 7] }));
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
