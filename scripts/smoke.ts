// Live end-to-end check against the real Tavily and Anthropic APIs.
// Usage: npm run smoke            (all scenarios)
//        npm run smoke -- happy   (one scenario by key)
// Runs are written to the normal database, so they also appear on the dashboard.
import { getHealth, missingSettings } from "../src/lib/config";
import * as repo from "../src/lib/db/repo";
import { createDefaultDeps, runPipeline } from "../src/lib/pipeline/runner";
import { validateProspect } from "../src/lib/pipeline/validate";
import type { ProspectInput, RunStatus } from "../src/lib/types";
import scenarios from "./demo-scenarios.json";

interface Scenario {
  key: string;
  title: string;
  prospect: ProspectInput;
  expect: RunStatus[];
}

async function main() {
  const missing = missingSettings();
  if (missing.length) {
    console.error(`Smoke test needs real credentials. Missing: ${missing.join(", ")}. Add them to .env.local.`);
    process.exit(1);
  }
  const health = getHealth();
  console.log(`LLM: ${health.llmProvider} (${health.model})`);

  const only = process.argv[2];
  const selected = (scenarios as Scenario[]).filter((s) => !only || s.key === only);
  if (selected.length === 0) {
    console.error(`Unknown scenario "${only}". Options: ${(scenarios as Scenario[]).map((s) => s.key).join(", ")}`);
    process.exit(1);
  }

  let mismatches = 0;
  for (const scenario of selected) {
    const input = validateProspect(scenario.prospect);
    if (!input.ok) throw new Error(`Scenario ${scenario.key} has invalid input: ${JSON.stringify(input.errors)}`);
    const run = repo.createRun(input.value);
    const started = Date.now();
    console.log(`\n▶ ${scenario.title}  (run ${run.id})`);
    await runPipeline(run.id, createDefaultDeps());
    const d = repo.getRunDetail(run.id)!;

    for (const e of d.events.filter((e) => e.status !== "running")) console.log(`  [${e.status.padEnd(9)}] ${e.stage}: ${e.message}`);
    const hook = d.signals.find((s) => s.id === d.hook?.signalId);
    if (hook) {
      const src = d.sources.find((s) => s.id === hook.sourceId);
      console.log(`  hook: ${hook.claim}\n        "${hook.evidenceQuote}"\n        ${src?.url}`);
    }
    if (d.identity?.candidates.length) for (const c of d.identity.candidates) console.log(`  candidate: ${c.name}, ${c.role ?? "?"} at ${c.company ?? "?"} (${c.evidenceUrl})`);
    for (const l of d.limitations) console.log(`  limitation: ${l}`);
    const draft = d.drafts.at(-1);
    if (draft) console.log(`  draft (${draft.kind}): ${draft.subject}\n${draft.body.replace(/^/gm, "    | ")}\n  guard: ${draft.guard.issues.map((i) => `${i.severity}:${i.code}`).join(", ") || "clean"}`);

    const ok = scenario.expect.includes(d.status);
    if (!ok) mismatches++;
    console.log(`  → ${d.status} in ${((Date.now() - started) / 1000).toFixed(1)}s ${ok ? "(as expected)" : `(EXPECTED ${scenario.expect.join(" or ")})`}${d.error ? `\n  error: ${d.error}` : ""}`);
  }
  console.log(`\n${selected.length - mismatches}/${selected.length} scenarios ended in the expected status.`);
  process.exit(mismatches ? 2 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
