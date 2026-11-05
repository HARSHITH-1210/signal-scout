import type { StageName } from "./types";

export type ProviderErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  /** Daily/monthly allowance or credits used up: won't clear on retry; the provider is skipped until it resets. */
  | "quota"
  | "unavailable"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output";

export type ProviderName = "tavily" | "exa" | "gdelt" | "jina" | "direct" | "anthropic" | "openrouter" | "gemini";

/** Failure talking to an external provider. `message` is safe to show users. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** A stage failed in a way that should stop the run. `message` is safe to show users. */
export class PipelineError extends Error {
  constructor(
    public readonly stage: StageName,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}
