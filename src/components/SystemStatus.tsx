"use client";

import { useState } from "react";
import type { ProbeResult, ProviderStatus } from "@/lib/providers/status";
import { formatDateTime, type Tone } from "@/lib/ui/format";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { send } from "./run/api";

const STATE: Record<ProviderStatus["state"], { label: string; tone: Tone }> = {
  up: { label: "Up", tone: "ok" },
  degraded: { label: "Recent failures", tone: "warn" },
  down: { label: "Paused", tone: "bad" },
  off: { label: "Not set", tone: "neutral" },
};

/** Every provider in the fallback chains: whether it's up, paused (and until when), and the last day's calls. */
export function SystemStatus({ initial }: { initial: ProviderStatus[] }) {
  const [providers, setProviders] = useState(initial);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    setBusy(true);
    setError(null);
    const res = await send("/api/providers/test", "POST");
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const data = res.data as { results: ProbeResult[]; providers: ProviderStatus[] };
    setProviders(data.providers);
    setResults(Object.fromEntries(data.results.map((r) => [r.name, r])));
  }

  const ai = providers.filter((p) => p.role === "AI model" && p.configured);
  const allAiDown = ai.length > 0 && ai.every((p) => p.state === "down");

  return (
    <section aria-labelledby="status-title" className="rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id="status-title" className="text-[15px] font-bold">
          System status <span className="font-normal text-fg-muted">fallback chains</span>
        </h2>
        <button
          type="button"
          onClick={test}
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-obsidian px-3 text-[13px] font-bold text-obsidian hover:bg-canvas disabled:opacity-45"
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
          {busy ? "Testing…" : "Test connections"}
        </button>
      </div>
      {allAiDown && (
        <p className="border-b border-line bg-danger-soft px-5 py-2.5 text-sm text-danger">
          Every AI provider is paused, so new runs wait until one is back. Add another provider key, or test the connections after fixing a key.
        </p>
      )}
      {error && <p className="px-5 pt-3 text-sm text-danger">{error}</p>}
      <ul>
        {providers.map((p) => {
          const probe = results[p.name];
          return (
            <li key={p.name} className="border-b border-line-soft px-5 py-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-[140px] font-bold">{p.label}</span>
                <span className="acc text-fg-muted">
                  {p.role} · {p.position}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {p.calls24h > 0 && (
                    <span className="acc text-fg-muted">
                      {p.calls24h} {p.calls24h === 1 ? "call" : "calls"}
                      {p.failures24h ? `, ${p.failures24h} failed` : ""} / 24h
                    </span>
                  )}
                  <Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge>
                </span>
              </div>
              {p.state === "down" && p.downUntil && (
                <p className="mt-1 text-[13px] text-danger">
                  Skipped until {formatDateTime(p.downUntil)}
                  {p.lastError ? `: ${p.lastError}` : ""}
                </p>
              )}
              {p.state === "degraded" && p.lastError && <p className="mt-1 text-[13px] text-warn">Last error: {p.lastError}</p>}
              {probe && <p className={`mt-1 text-[13px] ${probe.ok ? "text-ok" : "text-danger"}`}>{probe.detail}</p>}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-5 py-2.5 text-[13px] text-fg-muted">
        Runs try providers top to bottom. A provider that runs out of quota is skipped until it resets; three outages in a row pause it for two minutes.
      </p>
    </section>
  );
}
