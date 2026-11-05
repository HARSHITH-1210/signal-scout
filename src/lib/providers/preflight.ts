import { getConfig } from "../config";
import { isDown } from "./health";

export type Preflight = { ok: true } | { ok: false; error: string; retryAt: string | null };

/**
 * Before a run starts: refuse when every configured AI provider is paused by the circuit breaker (a used-up
 * daily quota, a rejected key), instead of starting and failing minutes later. Missing keys aren't checked
 * here; the run still fails fast at the first stage that needs one, with the key's name.
 */
export function preflight(now = new Date()): Preflight {
  const chain = getConfig().llmChain;
  if (chain.length === 0) return { ok: true };
  const states = chain.map((name) => ({ name, ...isDown(name, now) }));
  if (states.some((s) => !s.down)) return { ok: true };
  const soonest = states.map((s) => s.until!).sort()[0] ?? null;
  const reasons = states.map((s) => `${s.name} (${s.reason ?? "paused"})`).join("; ");
  return {
    ok: false,
    retryAt: soonest,
    error: `No AI provider is available right now: ${reasons}. The first one is back at ${soonest ? new Date(soonest).toUTCString() : "an unknown time"}. Add another provider key or try again then.`,
  };
}
