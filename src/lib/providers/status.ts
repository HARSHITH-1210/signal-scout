import { getConfig, redact } from "../config";
import * as repo from "../db/repo";
import { ProviderError, type ProviderName } from "../errors";
import { isDown, recordFailure, recordSuccess } from "./health";

export interface ProviderStatus {
  name: ProviderName;
  label: string;
  role: "AI model" | "Search" | "Page reader";
  configured: boolean;
  /** Position in its chain: "primary", "fallback 1", … or "keyless fallback". */
  position: string;
  state: "up" | "degraded" | "down" | "off";
  downUntil: string | null;
  lastError: string | null;
  calls24h: number;
  failures24h: number;
}

const LABELS: Record<ProviderName, string> = {
  openrouter: "OpenRouter",
  gemini: "Gemini",
  anthropic: "Anthropic",
  tavily: "Tavily",
  exa: "Exa",
  gdelt: "GDELT news",
  jina: "Jina Reader",
  direct: "Direct page read",
};

/** Every provider with its circuit-breaker state and the last day's calls, for the System status panel. */
export function providerStatus(now = new Date()): ProviderStatus[] {
  const config = getConfig();
  const counts = repo.providerCallCounts(new Date(now.getTime() - 86_400_000).toISOString());
  const keyedSearch = Boolean(config.tavilyApiKey || config.exaApiKey);
  const llmConfigured: Record<string, boolean> = { openrouter: Boolean(config.openrouterApiKey), gemini: Boolean(config.geminiApiKey), anthropic: Boolean(config.anthropicApiKey) };
  const rows: Omit<ProviderStatus, "state" | "downUntil" | "lastError" | "calls24h" | "failures24h">[] = [
    ...(["openrouter", "gemini", "anthropic"] as const).map((name) => {
      const i = config.llmChain.indexOf(name);
      return { name, label: LABELS[name], role: "AI model" as const, configured: llmConfigured[name], position: i === 0 ? "primary" : i > 0 ? `fallback ${i}` : "not in use" };
    }),
    { name: "tavily", label: LABELS.tavily, role: "Search", configured: Boolean(config.tavilyApiKey), position: config.tavilyApiKey ? "primary" : "not set" },
    { name: "exa", label: LABELS.exa, role: "Search", configured: Boolean(config.exaApiKey), position: config.exaApiKey ? (config.tavilyApiKey ? "fallback 1" : "primary") : "not set" },
    { name: "gdelt", label: LABELS.gdelt, role: "Search", configured: keyedSearch, position: "keyless fallback" },
    { name: "jina", label: LABELS.jina, role: "Page reader", configured: keyedSearch, position: "keyless fallback" },
    { name: "direct", label: LABELS.direct, role: "Page reader", configured: keyedSearch, position: "last resort" },
  ];
  return rows.map((row) => {
    const health = repo.getProviderHealth(row.name);
    const down = isDown(row.name, now);
    const c = counts[row.name] ?? { calls: 0, failures: 0 };
    const state: ProviderStatus["state"] = !row.configured ? "off" : down.down ? "down" : (health?.consecutiveFailures ?? 0) > 0 ? "degraded" : "up";
    return { ...row, state, downUntil: down.until, lastError: health?.lastError ?? null, calls24h: c.calls, failures24h: c.failures };
  });
}

export interface ProbeResult {
  name: ProviderName;
  ok: boolean;
  detail: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Cheap live checks for "Test connections": endpoints that validate a key without spending model tokens
 * or search credits. A passing check clears the provider's circuit breaker; a rejected key opens it.
 */
export async function probeProviders(fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<ProbeResult[]> {
  const config = getConfig();
  const timeout = () => AbortSignal.timeout(10_000);
  const probes: Promise<ProbeResult>[] = [];
  const run = (name: ProviderName, fn: () => Promise<string>) =>
    probes.push(
      fn()
        .then((detail) => {
          recordSuccess(name);
          return { name, ok: true, detail };
        })
        .catch((error: unknown) => {
          const e = error instanceof ProviderError ? error : new ProviderError(name, "unavailable", redact(error instanceof Error ? error.message : String(error)));
          if (e.kind === "auth" || e.kind === "quota") recordFailure(name, e);
          return { name, ok: false, detail: e.message };
        }),
    );
  const fail = (name: ProviderName, status: number) => {
    if (status === 401 || status === 403) return new ProviderError(name, "auth", "The key was rejected.");
    return new ProviderError(name, "unavailable", `HTTP ${status}.`);
  };

  if (config.openrouterApiKey)
    run("openrouter", async () => {
      const res = await fetchImpl("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${config.openrouterApiKey}` }, signal: timeout() });
      if (!res.ok) throw fail("openrouter", res.status);
      const body = (await res.json().catch(() => ({}))) as { data?: { limit_remaining?: number | null; is_free_tier?: boolean } };
      if (body.data?.limit_remaining === 0) throw new ProviderError("openrouter", "quota", "The key's credit limit is used up.");
      return body.data?.is_free_tier ? "Key valid (free tier: the daily free-model limit applies)." : "Key valid.";
    });
  if (config.geminiApiKey)
    run("gemini", async () => {
      const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": config.geminiApiKey! }, signal: timeout() });
      if (!res.ok) throw fail("gemini", res.status);
      const body = (await res.json().catch(() => ({}))) as { models?: { name?: string }[] };
      const known = (body.models ?? []).some((m) => m.name === `models/${config.geminiModel}`);
      return known ? `Key valid; ${config.geminiModel} is available.` : `Key valid, but ${config.geminiModel} isn't in the model list. Check GEMINI_MODEL.`;
    });
  if (config.anthropicApiKey)
    run("anthropic", async () => {
      const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": config.anthropicApiKey!, "anthropic-version": "2023-06-01" }, signal: timeout() });
      if (!res.ok) throw fail("anthropic", res.status);
      return "Key valid.";
    });
  if (config.tavilyApiKey)
    run("tavily", async () => {
      const res = await fetchImpl("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${config.tavilyApiKey}` }, signal: timeout() });
      if (res.status === 404) return "Key not checked (usage endpoint unavailable); searches will tell.";
      if (!res.ok) throw fail("tavily", res.status);
      const body = (await res.json().catch(() => ({}))) as { key?: { usage?: number; limit?: number | null } };
      const { usage, limit } = body.key ?? {};
      if (typeof usage === "number" && typeof limit === "number" && usage >= limit) throw new ProviderError("tavily", "quota", `All ${limit} credits used this month.`);
      return typeof usage === "number" && typeof limit === "number" ? `Key valid; ${limit - usage} of ${limit} credits left.` : "Key valid.";
    });
  const results = await Promise.all(probes);
  if (config.exaApiKey) results.push({ name: "exa", ok: true, detail: "Not probed: every Exa call uses credit. Its first search will tell." });
  return results;
}
