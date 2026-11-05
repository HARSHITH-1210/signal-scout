import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { getConfig, redact } from "../config";
import { ProviderError } from "../errors";

export type LlmTask = "resolve_identity" | "extract_signals" | "find_conflicts" | "draft" | "check_claims" | "extract_profile" | "revise_draft";

export interface LlmRequest<T> {
  task: LlmTask;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Prefer a different provider from the one that served this task (an independent check). */
  independentOf?: LlmTask;
}

export interface LlmProvider {
  generate<T>(request: LlmRequest<T>): Promise<T>;
  /** Which backend served a task last (fallback chains only), so a second opinion can tell it came from elsewhere. */
  served?(task: LlmTask): string | null;
}

/**
 * Claude via the official SDK with schema-constrained output. No tools are ever passed: the model can
 * only return JSON matching our schema, so instructions hidden in web content cannot trigger actions.
 */
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey = getConfig().anthropicApiKey, model = getConfig().model) {
    if (!apiKey)
      throw new ProviderError("anthropic", "config", "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart.");
    // One retry: a timed-out request may already have been processed and billed, so retries cost twice.
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 180_000 });
    this.model = model;
  }

  private fallbackSupported = true;

  private call<T>(request: LlmRequest<T>, withFallback: boolean) {
    return this.client.beta.messages.parse({
      model: this.model,
      max_tokens: request.maxTokens ?? 16_000,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
      // Server-side refusal fallback: on a policy decline the API re-runs on a fallback model in the same call.
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    let response;
    try {
      try {
        response = await this.call(request, this.fallbackSupported);
      } catch (error) {
        // Some accounts/platforms don't accept the fallback beta; retry once without it rather than failing every call.
        // Accounts or models without the refusal-fallback beta reject it with a 400 that names the
        // parameter or the beta header; retry once without it rather than failing every call.
        if (this.fallbackSupported && error instanceof Anthropic.BadRequestError && /fallback|beta|anthropic-beta/i.test(error.message)) {
          this.fallbackSupported = false;
          response = await this.call(request, false);
        } else {
          throw error;
        }
      }
    } catch (error) {
      throw toProviderError(error);
    }

    if (response.stop_reason === "refusal")
      throw new ProviderError("anthropic", "refusal", "Claude declined this request. Review the input and try again.");
    if (response.stop_reason === "max_tokens")
      throw new ProviderError("anthropic", "truncated", "Claude's response was cut off before it finished.");
    if (response.parsed_output === null || response.parsed_output === undefined)
      throw new ProviderError("anthropic", "invalid_output", "Claude returned output that did not match the expected format.");
    return response.parsed_output as T;
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("anthropic", "auth", "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.");
  if (error instanceof Anthropic.RateLimitError)
    return new ProviderError("anthropic", "rate_limit", "Anthropic rate limit reached. Wait a minute and retry.");
  if (error instanceof Anthropic.NotFoundError)
    return new ProviderError("anthropic", "bad_request", "The configured Claude model was not found. Check ANTHROPIC_MODEL.");
  if (error instanceof Anthropic.BadRequestError)
    return new ProviderError("anthropic", "bad_request", `Anthropic rejected the request: ${redact(error.message).slice(0, 300)}`);
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderError("anthropic", "unavailable", "Could not reach the Anthropic API (network error or timeout).");
  if (error instanceof Anthropic.APIError)
    return new ProviderError("anthropic", "unavailable", `Anthropic API error (HTTP ${error.status ?? "unknown"}).`);
  if (error instanceof ProviderError) return error;
  return new ProviderError(
    "anthropic",
    "invalid_output",
    `Claude call failed: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 300)}`,
  );
}
