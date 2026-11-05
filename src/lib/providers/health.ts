import * as repo from "../db/repo";
import { ProviderError, type ProviderName } from "../errors";
import type { ProviderHealth } from "../types";

// After this many outages in a row, a provider is skipped for a short cooldown instead of being tried every call.
const OUTAGE_THRESHOLD = 3;
const OUTAGE_COOLDOWN_MS = 2 * 60_000;
// A rejected key won't fix itself, but the rep may update it; look again after an hour (or on "Test connections").
const AUTH_COOLDOWN_MS = 60 * 60_000;

const nextUtcMidnight = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
// Gemini's daily quota resets at midnight Pacific time (08:00 UTC, near enough for a cooldown).
const nextPacificMidnight = (now: Date) => {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8));
  return reset.getTime() > now.getTime() ? reset : new Date(reset.getTime() + 86_400_000);
};

/** When a used-up allowance comes back, by provider. Conservative where the provider doesn't say. */
export function quotaResetAt(provider: ProviderName, now: Date): Date {
  switch (provider) {
    case "openrouter":
      return nextUtcMidnight(now);
    case "gemini":
      return nextPacificMidnight(now);
    case "tavily":
    case "exa":
      return nextMonthStart(now);
    default:
      return new Date(now.getTime() + 60 * 60_000);
  }
}

/** True when the circuit breaker says to skip this provider for now. */
export function isDown(provider: ProviderName, now = new Date()): { down: boolean; until: string | null; reason: string | null } {
  const h = repo.getProviderHealth(provider);
  if (!h?.downUntil) return { down: false, until: null, reason: null };
  const down = new Date(h.downUntil).getTime() > now.getTime();
  return { down, until: down ? h.downUntil : null, reason: down ? h.lastError : null };
}

export function recordSuccess(provider: ProviderName, now = new Date()): void {
  const prev = repo.getProviderHealth(provider);
  repo.saveProviderHealth({
    provider,
    downUntil: null,
    consecutiveFailures: 0,
    lastError: prev?.lastError ?? null,
    lastErrorKind: prev?.lastErrorKind ?? null,
    lastOkAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

/** Opens the circuit on quota or a bad key straight away, and after repeated outages. */
export function recordFailure(provider: ProviderName, error: ProviderError, now = new Date()): ProviderHealth {
  const prev = repo.getProviderHealth(provider);
  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
  let downUntil: Date | null = null;
  if (error.kind === "quota") downUntil = quotaResetAt(provider, now);
  else if (error.kind === "auth") downUntil = new Date(now.getTime() + AUTH_COOLDOWN_MS);
  else if ((error.kind === "unavailable" || error.kind === "rate_limit") && consecutiveFailures >= OUTAGE_THRESHOLD)
    downUntil = new Date(now.getTime() + OUTAGE_COOLDOWN_MS);
  const health: ProviderHealth = {
    provider,
    downUntil: downUntil?.toISOString() ?? prev?.downUntil ?? null,
    consecutiveFailures,
    lastError: error.message,
    lastErrorKind: error.kind,
    lastOkAt: prev?.lastOkAt ?? null,
    updatedAt: now.toISOString(),
  };
  repo.saveProviderHealth(health);
  return health;
}

/** Errors worth trying the next provider for. A request the next provider would also reject (bad input) isn't one of them. */
export function shouldFailOver(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true; // unexpected crash in an adapter: another provider may be fine
  return error.kind !== "config";
}
