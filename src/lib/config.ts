import path from "node:path";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free";
// Google's alias for its current Flash model on the free tier; override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
// Tried in order when the main model is overloaded (503) or retired (404); same key and quota.
export const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-2.5-flash"];
export const RUN_DEADLINE_MS = 20 * 60_000;

export type LlmProviderName = "anthropic" | "openrouter" | "gemini";
const LLM_NAMES: LlmProviderName[] = ["openrouter", "gemini", "anthropic"];

export interface AppConfig {
  /** Which LLM backend runs the pipeline. `null` means LLM_PROVIDER holds an unrecognised value. */
  llmProvider: LlmProviderName | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
  tavilyApiKey: string | null;
  model: string;
  openrouterModel: string;
  /** Extra OpenRouter models tried in the same request when the first is unavailable (they share its quota). */
  openrouterFallbackModels: string[];
  geminiApiKey: string | null;
  geminiModel: string;
  geminiFallbackModels: string[];
  exaApiKey: string | null;
  jinaApiKey: string | null;
  /**
   * LLM providers in the order a run tries them: the primary, then every other one that has a key.
   * LLM_FALLBACKS (e.g. "gemini,anthropic", or "none") overrides the fallback order.
   */
  llmChain: LlmProviderName[];
  /** Simulated provider failures for demos and drills, e.g. "tavily:quota,openrouter:down". Off unless set. */
  faultInject: string | null;
  dataDir: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** Must match an authorised redirect URI on the Google OAuth client. */
  googleRedirectUri: string;
}

/**
 * LLM_PROVIDER wins when set. Otherwise use Anthropic if its key is present, else OpenRouter if
 * its key is present, else Anthropic (so the missing-key message names the default).
 */
function resolveProvider(explicit: string | null, anthropicKey: string | null, openrouterKey: string | null, geminiKey: string | null = null): LlmProviderName | null {
  if (explicit) {
    const value = explicit.toLowerCase();
    return (LLM_NAMES as string[]).includes(value) ? (value as LlmProviderName) : null;
  }
  if (anthropicKey) return "anthropic";
  if (openrouterKey) return "openrouter";
  if (geminiKey) return "gemini";
  return "anthropic";
}

function buildLlmChain(primary: LlmProviderName | null, fallbacks: string | null, keys: Record<LlmProviderName, string | null>): LlmProviderName[] {
  if (!primary) return [];
  const rest =
    fallbacks?.toLowerCase() === "none"
      ? []
      : fallbacks
        ? fallbacks.split(",").map((f) => f.trim().toLowerCase()).filter((f): f is LlmProviderName => (LLM_NAMES as string[]).includes(f))
        : LLM_NAMES;
  return [primary, ...rest.filter((name) => name !== primary && keys[name])].filter((name, i, all) => all.indexOf(name) === i);
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Reads configuration from the environment on every call so tests and restarts see changes. */
export function getConfig(): AppConfig {
  const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
  const openrouterApiKey = readEnv("OPENROUTER_API_KEY");
  const geminiApiKey = readEnv("GEMINI_API_KEY");
  const llmProvider = resolveProvider(readEnv("LLM_PROVIDER"), anthropicApiKey, openrouterApiKey, geminiApiKey);
  return {
    llmProvider,
    anthropicApiKey,
    openrouterApiKey,
    tavilyApiKey: readEnv("TAVILY_API_KEY"),
    model: readEnv("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
    openrouterModel: readEnv("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL,
    openrouterFallbackModels: (readEnv("OPENROUTER_FALLBACK_MODELS") ?? "").split(",").map((m) => m.trim()).filter(Boolean).slice(0, 2),
    geminiApiKey,
    geminiModel: readEnv("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL,
    geminiFallbackModels:
      readEnv("GEMINI_FALLBACK_MODELS")?.toLowerCase() === "none"
        ? []
        : (readEnv("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean) ?? DEFAULT_GEMINI_FALLBACK_MODELS).slice(0, 3),
    exaApiKey: readEnv("EXA_API_KEY"),
    jinaApiKey: readEnv("JINA_API_KEY"),
    llmChain: buildLlmChain(llmProvider, readEnv("LLM_FALLBACKS"), { anthropic: anthropicApiKey, openrouter: openrouterApiKey, gemini: geminiApiKey }),
    faultInject: readEnv("FAULT_INJECT"),
    dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), readEnv("DATA_DIR") ?? "data"),
    googleClientId: readEnv("GOOGLE_CLIENT_ID"),
    googleClientSecret: readEnv("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: readEnv("GOOGLE_REDIRECT_URI") ?? "http://localhost:3000/api/gmail/callback",
  };
}

/** Presence-only health view. Never include key values here; this is returned to the browser. */
export function getHealth() {
  const config = getConfig();
  const keyFor = { openrouter: config.openrouterApiKey, anthropic: config.anthropicApiKey, gemini: config.geminiApiKey };
  const llmConfigured = config.llmProvider ? keyFor[config.llmProvider] !== null : false;
  return {
    llmProvider: config.llmProvider ?? "invalid",
    llmConfigured,
    model: config.llmProvider === "openrouter" ? config.openrouterModel : config.llmProvider === "gemini" ? config.geminiModel : config.model,
    /** Providers a run will try, in order (primary first). */
    llmChain: config.llmChain,
    geminiConfigured: config.geminiApiKey !== null,
    exaConfigured: config.exaApiKey !== null,
    anthropicConfigured: config.anthropicApiKey !== null,
    openrouterConfigured: config.openrouterApiKey !== null,
    tavilyConfigured: config.tavilyApiKey !== null,
  };
}

/** Human-readable list of missing settings, for the UI banner and the smoke script. */
export function missingSettings(health = getHealth()): string[] {
  const missing: string[] = [];
  if (health.llmProvider === "invalid") missing.push('a valid LLM_PROVIDER ("openrouter", "gemini" or "anthropic")');
  else if (!health.llmConfigured)
    missing.push(
      health.llmProvider === "openrouter" ? "OPENROUTER_API_KEY" : health.llmProvider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY (or OPENROUTER_API_KEY / GEMINI_API_KEY)",
    );
  // Exa can stand in for Tavily (and keyless GDELT backs both), but at least one keyed search provider is needed.
  if (!health.tavilyConfigured && !health.exaConfigured) missing.push("TAVILY_API_KEY (or EXA_API_KEY)");
  return missing;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /tvly-[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g, // Google (Gemini) API keys
  /jina_[A-Za-z0-9_-]{16,}/g,
  /sk-or-v1-[A-Za-z0-9_-]{8,}/g,
  /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi,
  /ya29\.[A-Za-z0-9._-]{8,}/g, // Google access tokens
  /1\/\/[A-Za-z0-9._-]{20,}/g, // Google refresh tokens
  /GOCSPX-[A-Za-z0-9_-]{8,}/g, // Google client secrets
  /(x-api-key["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}/gi,
];

/** Removes anything that looks like a credential, including the configured key values themselves. */
export function redact(input: string): string {
  let out = input;
  const { anthropicApiKey, openrouterApiKey, tavilyApiKey, googleClientSecret, geminiApiKey, exaApiKey, jinaApiKey } = getConfig();
  for (const key of [anthropicApiKey, openrouterApiKey, tavilyApiKey, googleClientSecret, geminiApiKey, exaApiKey, jinaApiKey]) {
    if (key && key.length >= 8) out = out.split(key).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}

/** Server-side logging that always redacts. */
export function logError(context: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[signal-scout] ${context}: ${redact(message)}`);
}
