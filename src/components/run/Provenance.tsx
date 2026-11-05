"use client";

import type { Degradation, ProviderCall } from "@/lib/types";
import { formatMs, type Tone } from "@/lib/ui/format";
import { Badge } from "../Badge";
import { Icon } from "../Icon";

const OUTCOME: Record<ProviderCall["outcome"], { label: string; tone: Tone }> = {
  ok: { label: "ok", tone: "ok" },
  error: { label: "failed", tone: "bad" },
  skipped: { label: "skipped", tone: "neutral" },
};

/** What a run had to do without: shown above the outcome so a degraded success never looks like a clean one. */
export function DegradedBanner({ degraded }: { degraded: Degradation[] }) {
  if (degraded.length === 0) return null;
  return (
    <section aria-labelledby="degraded-title" className="rounded-[var(--radius-panel)] border border-ochre/40 bg-ochre-soft p-4 text-sm text-ochre">
      <h2 id="degraded-title" className="flex items-center gap-2 font-bold">
        <Icon name="alert" />
        Degraded run
      </h2>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">
        {[...new Set(degraded.map((d) => d.message))].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </section>
  );
}

/** Which provider and model served each step, every failure and fallback, with timings. */
export function ProvenancePanel({ calls }: { calls: ProviderCall[] }) {
  if (calls.length === 0) return null;
  const failures = calls.filter((c) => c.outcome === "error").length;
  return (
    <details className="rounded-[var(--radius-panel)] border border-rule bg-paper">
      <summary className="cursor-pointer px-5 py-3 text-[15px] font-bold">
        How this run was produced{" "}
        <span className="acc font-normal text-muted">
          {calls.length} calls{failures ? `, ${failures} failed` : ""}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="text-muted">
            <tr>
              <th className="px-5 py-2 font-bold">Stage</th>
              <th className="px-3 py-2 font-bold">Step</th>
              <th className="px-3 py-2 font-bold">Provider</th>
              <th className="px-3 py-2 font-bold">Result</th>
              <th className="px-5 py-2 text-right font-bold">Time</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="border-t border-rule-soft align-top">
                <td className="px-5 py-2 text-ink-soft">{c.stage?.replace(/_/g, " ") ?? "–"}</td>
                <td className="px-3 py-2 text-ink-soft">{c.task.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">
                  <span className="font-bold">{c.provider}</span>
                  {c.model && <span className="acc block text-[12px] text-muted">{c.model}</span>}
                  {c.fallbackFrom && <span className="block text-[12px] text-ochre">fallback after {c.fallbackFrom}</span>}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Badge>
                  {c.message && c.outcome !== "ok" && <span className="mt-1 block text-[12px] text-ink-soft">{c.message}</span>}
                </td>
                <td className="acc px-5 py-2 text-right">{c.outcome === "skipped" ? "–" : formatMs(c.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
