import { z } from "zod";
import { DEFAULT_OPENROUTER_MODEL, getConfig, redact } from "../config";
import { ProviderError } from "../errors";
import { readJsonCapped, ResponseTooLargeError } from "./http";
import type { LlmProvider, LlmRequest } from "./llm";

export { DEFAULT_OPENROUTER_MODEL };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 180_000;
const MAX_TRANSPORT_ATTEMPTS = 2;
/** Hard cap on OpenRouter requests per provider instance (one instance per run). Protects the free daily quota. */
export const MAX_REQUESTS_PER_RUN = 14;

const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  error: z.object({ code: z.union([z.number(), z.string()]).nullish(), message: z.string().nullish() }).nullish(),
});

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const JSON_ONLY_RULE =
  "Respond with exactly one JSON object that matches the provided JSON schema. No prose, no explanations, no markdown code fences.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pulls the JSON object out of a reply, tolerating code fences or stray text around it. */
export function extractJson(content: string): unknown {
  const unfenced = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Reply contained no JSON object.");
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function errorFor(status: number, message: string): ProviderError {
  const detail = redact(message).slice(0, 300);
  if (status === 401) return new ProviderError("openrouter", "auth", "OpenRouter rejected the API key. Check OPENROUTER_API_KEY.");
  if (status === 402)
    return new ProviderError("openrouter", "quota", "OpenRouter says this account has insufficient credits for the model. Use a model ending in :free, or add credits.");
  if (status === 403) return new ProviderError("openrouter", "refusal", `OpenRouter's moderation blocked this request. ${detail}`);
  if (status === 404)
    return new ProviderError("openrouter", "bad_request", `OpenRouter couldn't use this model (${detail}). Check OPENROUTER_MODEL and that the model supports structured outputs.`);
  if (status === 429)
    return /per[- ]day|daily/i.test(message)
      ? new ProviderError("openrouter", "quota", "OpenRouter's daily limit for free models is used up. It resets daily; buying $10 of credits raises it.")
      : new ProviderError("openrouter", "rate_limit", "OpenRouter rate limit reached. Wait a minute and retry.");
  if (status === 503)
    return new ProviderError("openrouter", "unavailable", "No OpenRouter provider is currently serving this model with structured outputs. Retry, or pick another model.");
  if (status >= 500 || status === 408) return new ProviderError("openrouter", "unavailable", `OpenRouter or the model provider failed (HTTP ${status}).`);
  return new ProviderError("openrouter", "bad_request", `OpenRouter rejected the request (HTTP ${status}): ${detail}`);
}

const isRetryable = (e: ProviderError) =>
  e.kind === "unavailable" || e.kind === "rate_limit";

/**
 * Any OpenRouter model (including free ones) via schema-constrained JSON output. Like the Anthropic
 * provider, no tools are passed, and every reply is validated against the same zod schema.
 */
export class OpenRouterProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private requestsUsed = 0;

  constructor(
    apiKey = getConfig().openrouterApiKey,
    model = getConfig().openrouterModel,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    // Same-account models OpenRouter tries when the first is down. They share its quota, so they help with
    // outages, not with a used-up daily limit (that's what the next provider in the chain is for).
    private readonly fallbackModels: string[] = getConfig().openrouterFallbackModels,
  ) {
    if (!apiKey) throw new ProviderError("openrouter", "config", "OPENROUTER_API_KEY is not set. Add it to .env.local and restart.");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    const schema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete schema.$schema; // the API wants the bare schema object
    const messages: ChatMessage[] = [
      { role: "system", content: `${request.system}\n\n${JSON_ONLY_RULE}` },
      { role: "user", content: request.user },
    ];

    // Smaller models sometimes return near-miss JSON; give one chance to correct it, citing the exact problems.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const content = await this.complete(request, schema, messages);
      let issues: string;
      try {
        const parsed = request.schema.safeParse(extractJson(content));
        if (parsed.success) return parsed.data;
        issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      } catch (error) {
        issues = error instanceof Error ? error.message : "Invalid JSON.";
      }
      if (attempt === 2)
        throw new ProviderError("openrouter", "invalid_output", `The model's reply didn't match the expected format (${issues}). Try again or choose a stronger model.`);
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `That reply did not match the required JSON schema: ${issues}. Return only the corrected JSON object.` },
      );
    }
    throw new ProviderError("openrouter", "invalid_output", "No valid reply from the model.");
  }

  private async complete(request: LlmRequest<unknown>, schema: Record<string, unknown>, messages: ChatMessage[]): Promise<string> {
    let lastError: ProviderError | null = null;
    for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
      if (this.requestsUsed >= MAX_REQUESTS_PER_RUN)
        throw new ProviderError("openrouter", "rate_limit", `Stopped after ${MAX_REQUESTS_PER_RUN} OpenRouter requests in this run to protect your daily quota. Retry the step later.`);
      this.requestsUsed++;
      try {
        const response = await this.fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Signal Scout",
          },
          body: JSON.stringify({
            model: this.model,
            ...(this.fallbackModels.length ? { models: [this.model, ...this.fallbackModels] } : {}),
            messages,
            max_tokens: request.maxTokens ?? 16_000,
            response_format: { type: "json_schema", json_schema: { name: request.task, strict: true, schema } },
            // Only route to providers that actually enforce the schema.
            provider: { require_parameters: true },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = ChatResponse.safeParse(
          await readJsonCapped(response).catch((e: unknown) => {
            if (e instanceof ResponseTooLargeError) throw new ProviderError("openrouter", "invalid_output", e.message);
            return {};
          }),
        );
        const apiError = body.success ? body.data.error : null;
        if (!response.ok) throw errorFor(response.status, apiError?.message ?? "");
        if (!body.success) throw new ProviderError("openrouter", "invalid_output", "OpenRouter returned an unexpected response shape.");
        if (apiError) throw errorFor(typeof apiError.code === "number" ? apiError.code : 502, apiError.message ?? "");

        const choice = body.data.choices?.[0];
        if (choice?.finish_reason === "length") throw new ProviderError("openrouter", "truncated", "The model's response was cut off before it finished.");
        if (choice?.finish_reason === "content_filter") throw new ProviderError("openrouter", "refusal", "The model's provider filtered this response.");
        if (choice?.finish_reason === "error") throw new ProviderError("openrouter", "unavailable", "The model provider failed while generating.");
        const content = choice?.message?.content;
        // Free endpoints occasionally return an empty completion; treat it as transient and retry within budget.
        if (!content?.trim()) throw new ProviderError("openrouter", "unavailable", "The model returned an empty reply.");
        return content;
      } catch (error) {
        lastError =
          error instanceof ProviderError
            ? error
            : new ProviderError("openrouter", "unavailable", `Could not reach OpenRouter: ${redact(error instanceof Error ? error.message : String(error))}`);
        if (!isRetryable(lastError)) throw lastError;
      }
      if (attempt < MAX_TRANSPORT_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
    }
    throw lastError ?? new ProviderError("openrouter", "unavailable", "OpenRouter request failed.");
  }
}
