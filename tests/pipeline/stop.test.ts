import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "@/lib/db/repo";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { enqueueRun, resumeModeFor, runPipeline, setDepsFactory, stopRun } from "@/lib/pipeline/runner";
import type { SearchProvider } from "@/lib/providers/search";
import { POST as stopRoute } from "@/app/api/runs/[id]/stop/route";
import { deps, FakeSearch } from "../fixtures/fakes";
import { NORTHWIND, northwindLlm, northwindSearch } from "../fixtures/scenarios";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = () => new Request("http://localhost/api", { method: "POST" });

beforeEach(() => {
  useInMemoryDbForTests();
  setDepsFactory(() => deps(northwindSearch(), northwindLlm()));
});

describe("stopping a run", () => {
  it("stops mid-stage at once, keeps what was found, and can be resumed", async () => {
    const run = repo.createRun(NORTHWIND);
    const controller = new AbortController();
    const inner = northwindSearch();
    // The rep presses Stop while research is under way.
    const search = new FakeSearch((q) => {
      if (/news announcement/.test(q.query)) controller.abort();
      return (inner as unknown as { handler: (q: unknown) => never }).handler(q);
    }, { "https://northwindfreight.com": "Northwind Freight is a digital freight network." });
    await runPipeline(run.id, { ...deps(search, northwindLlm()), signal: controller.signal });

    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("stopped");
    expect(d.error).toMatch(/Stopped by you during research/);
    expect(d.identity?.status).toBe("resolved"); // earlier work kept
    expect(d.events.at(-1)?.message).toMatch(/Stopped by you/);
    expect(d.drafts).toHaveLength(0);

    const plan = resumeModeFor(run.id);
    expect(plan).toMatchObject({ ok: true, mode: "from_research" });
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()), plan.ok ? plan.mode : "full");
    expect(repo.getRun(run.id)?.status).toBe("awaiting_review");
  });

  it("stopping a draft regeneration keeps the existing draft", async () => {
    const run = repo.createRun(NORTHWIND);
    await runPipeline(run.id, deps(northwindSearch(), northwindLlm()));
    const controller = new AbortController();
    const llm = northwindLlm({
      draft: () => {
        controller.abort();
        return new Error("never reached");
      },
    });
    await runPipeline(run.id, { ...deps(northwindSearch(), llm), signal: controller.signal }, "draft_only");
    const d = repo.getRunDetail(run.id)!;
    expect(d.status).toBe("awaiting_review");
    expect(d.error).toMatch(/Regeneration stopped/);
    expect(d.drafts).toHaveLength(1);
  });

  it("drops a queued run at once and aborts a running one, through the API", async () => {
    // Searches that never answer keep the two worker slots busy, so a third run waits in the queue.
    const hanging: SearchProvider = { search: () => new Promise(() => undefined), extract: () => new Promise(() => undefined) };
    setDepsFactory(() => deps(hanging as never, northwindLlm()));
    const [a, b, c] = [repo.createRun(NORTHWIND), repo.createRun(NORTHWIND), repo.createRun(NORTHWIND)];
    for (const r of [a, b, c]) enqueueRun(r.id);
    expect(repo.getRun(c.id)?.status).toBe("queued");

    const queued = await stopRoute(post(), params(c.id));
    expect(queued.status).toBe(202);
    expect((await queued.json()).stopped).toBe("queued");
    expect(repo.getRun(c.id)).toMatchObject({ status: "stopped", error: "Stopped by you before it started." });

    for (const r of [a, b]) expect((await stopRoute(post(), params(r.id))).status).toBe(202);
    await vi.waitFor(() => {
      expect(repo.getRun(a.id)?.status).toBe("stopped");
      expect(repo.getRun(b.id)?.status).toBe("stopped");
    });
    expect((await stopRoute(post(), params(a.id))).status).toBe(409); // already stopped
  });
});
