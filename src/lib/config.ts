import path from "node:path";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free";

export type LlmProviderName = "anthropic" | "openrouter";

export interface AppConfig {
  /** Which LLM backend runs the pipeline. `null` means LLM_PROVIDER holds an unrecognised value. */
  llmProvider: LlmProviderName | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
  tavilyApiKey: string | null;
  model: string;
  openrouterModel: string;
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
function resolveProvider(explicit: string | null, anthropicKey: string | null, openrouterKey: string | null): LlmProviderName | null {
  if (explicit) {
    const value = explicit.toLowerCase();
    return value === "anthropic" || value === "openrouter" ? value : null;
  }
  if (anthropicKey) return "anthropic";
  if (openrouterKey) return "openrouter";
  return "anthropic";
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Reads configuration from the environment on every call so tests and restarts see changes. */
export function getConfig(): AppConfig {
  const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
  const openrouterApiKey = readEnv("OPENROUTER_API_KEY");
  return {
    llmProvider: resolveProvider(readEnv("LLM_PROVIDER"), anthropicApiKey, openrouterApiKey),
    anthropicApiKey,
    openrouterApiKey,
    tavilyApiKey: readEnv("TAVILY_API_KEY"),
    model: readEnv("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
    openrouterModel: readEnv("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL,
    dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), readEnv("DATA_DIR") ?? "data"),
    googleClientId: readEnv("GOOGLE_CLIENT_ID"),
    googleClientSecret: readEnv("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: readEnv("GOOGLE_REDIRECT_URI") ?? "http://localhost:3000/api/gmail/callback",
  };
}

/** Presence-only health view. Never include key values here; this is returned to the browser. */
export function getHealth() {
  const config = getConfig();
  const llmConfigured =
    config.llmProvider === "openrouter" ? config.openrouterApiKey !== null : config.llmProvider === "anthropic" ? config.anthropicApiKey !== null : false;
  return {
    llmProvider: config.llmProvider ?? "invalid",
    llmConfigured,
    model: config.llmProvider === "openrouter" ? config.openrouterModel : config.model,
    anthropicConfigured: config.anthropicApiKey !== null,
    openrouterConfigured: config.openrouterApiKey !== null,
    tavilyConfigured: config.tavilyApiKey !== null,
  };
}

/** Human-readable list of missing settings, for the UI banner and the smoke script. */
export function missingSettings(health = getHealth()): string[] {
  const missing: string[] = [];
  if (health.llmProvider === "invalid") missing.push('a valid LLM_PROVIDER ("anthropic" or "openrouter")');
  else if (!health.llmConfigured) missing.push(health.llmProvider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY (or OPENROUTER_API_KEY)");
  if (!health.tavilyConfigured) missing.push("TAVILY_API_KEY");
  return missing;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /tvly-[A-Za-z0-9_-]{8,}/g,
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
  const { anthropicApiKey, openrouterApiKey, tavilyApiKey, googleClientSecret } = getConfig();
  for (const key of [anthropicApiKey, openrouterApiKey, tavilyApiKey, googleClientSecret]) {
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
