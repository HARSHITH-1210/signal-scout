import type { StageName } from "./types";

export type ProviderErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output";

/** Failure talking to an external provider (Tavily or Anthropic). `message` is safe to show users. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: "tavily" | "anthropic" | "openrouter",
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
