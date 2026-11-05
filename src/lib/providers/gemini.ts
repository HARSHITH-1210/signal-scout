import { z } from "zod";
import { getConfig, redact } from "../config";
import { ProviderError } from "../errors";
import { readJsonCapped, ResponseTooLargeError } from "./http";
import type { LlmProvider, LlmRequest } from "./llm";
import { extractJson } from "./openrouter";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 120_000;
// A busy model takes ~30s to say so; remember it for a while so later calls in this process skip it.
const OVERLOAD_COOLDOWN_MS = 5 * 60_000;
const overloadedUntil = new Map<string, number>();

/** Test hook: forget remembered overloads. */
export function resetGeminiOverloads() {
  overloadedUntil.clear();
}

/** Per-run cap, like OpenRouter's: the free tier's daily allowance is shared by every run. */
export const GEMINI_MAX_REQUESTS_PER_RUN = 14;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const GenerateResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().nullish() })).nullish() }).nullish(),
        finishReason: z.string().nullish(),
      }),
    )
    .nullish(),
  promptFeedback: z.object({ blockReason: z.string().nullish() }).nullish(),
  error: z.object({ code: z.number().nullish(), message: z.string().nullish(), status: z.string().nullish() }).nullish(),
});

function errorFor(status: number, message: string): ProviderError {
  const detail = redact(message).slice(0, 300);
  if (status === 401 || status === 403) return new ProviderError("gemini", "auth", "Google rejected the Gemini API key. Check GEMINI_API_KEY.");
  if (status === 429)
    return /per ?day|daily|quota/i.test(message)
      ? new ProviderError("gemini", "quota", "Gemini's free daily quota is used up. It resets at midnight Pacific time.")
      : new ProviderError("gemini", "rate_limit", "Gemini's per-minute limit was hit. Wait a minute and retry.");
  if (status === 404) return new ProviderError("gemini", "bad_request", `Gemini couldn't use this model (${detail}). Check GEMINI_MODEL.`);
  if (status >= 500)
    return new ProviderError("gemini", "unavailable", /high demand|overloaded/i.test(message) ? `Gemini is overloaded right now (HTTP ${status}).` : `Gemini is unavailable (HTTP ${status}).`);
  return new ProviderError("gemini", "bad_request", `Gemini rejected the request (HTTP ${status}): ${detail}`);
}

/**
 * Google Gemini via its REST API with a JSON schema on the response. Like the other backends: no tools,
 * and every reply is validated against the caller's zod schema (one corrective retry on a near miss).
 */
export class GeminiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly models: string[];
  private requestsUsed = 0;
  /** The model that answered last (an overloaded main model may hand over to a backup). */
  lastModel: string | null = null;

  constructor(
    apiKey = getConfig().geminiApiKey,
    model = getConfig().geminiModel,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    fallbackModels: string[] = getConfig().geminiFallbackModels,
    private readonly retryDelayMs = 1_000,
  ) {
    if (!apiKey) throw new ProviderError("gemini", "config", "GEMINI_API_KEY is not set.");
    this.apiKey = apiKey;
    this.models = [model, ...fallbackModels.filter((m) => m !== model)];
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    const schema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete schema.$schema;
    const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [{ role: "user", parts: [{ text: request.user }] }];

    for (let attempt = 1; attempt <= 2; attempt++) {
      const text = await this.complete(request, schema, contents);
      let issues: string;
      try {
        const parsed = request.schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      } catch (error) {
        issues = error instanceof Error ? error.message : "Invalid JSON.";
      }
      if (attempt === 2) throw new ProviderError("gemini", "invalid_output", `Gemini's reply didn't match the expected format (${issues}).`);
      contents.push({ role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: `That reply did not match the required JSON schema: ${issues}. Return only the corrected JSON object.` }] });
    }
    throw new ProviderError("gemini", "invalid_output", "No valid reply from Gemini.");
  }

  /**
   * Google's busiest models often answer 503 "high demand" while lighter ones are fine. Retry an overload
   * once, then move to the next model; a retired model (404) moves on straight away.
   */
  private async complete(request: LlmRequest<unknown>, schema: Record<string, unknown>, contents: unknown[]): Promise<string> {
    let lastError: ProviderError | null = null;
    const now = Date.now();
    const fresh = this.models.filter((m) => (overloadedUntil.get(m) ?? 0) <= now);
    // If every model is cooling down, try them all anyway rather than refuse outright.
    for (const model of fresh.length ? fresh : this.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const text = await this.completeWith(model, request, schema, contents);
          this.lastModel = model;
          return text;
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          lastError = error;
          const overloaded = error.kind === "unavailable" && /HTTP 5\d\d|high demand|overloaded/i.test(error.message);
          const retired = error.kind === "bad_request" && /couldn't use this model/.test(error.message);
          if (!overloaded && !retired) throw error;
          if (overloaded && attempt === 1) {
            await new Promise((r) => setTimeout(r, this.retryDelayMs));
            continue;
          }
          if (overloaded) overloadedUntil.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
          break; // next model
        }
      }
    }
    throw lastError ?? new ProviderError("gemini", "unavailable", "Gemini is unavailable.");
  }

  private async completeWith(model: string, request: LlmRequest<unknown>, schema: Record<string, unknown>, contents: unknown[]): Promise<string> {
    if (this.requestsUsed >= GEMINI_MAX_REQUESTS_PER_RUN)
      throw new ProviderError("gemini", "rate_limit", `Stopped after ${GEMINI_MAX_REQUESTS_PER_RUN} Gemini requests in this run to protect the daily quota.`);
    this.requestsUsed++;
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents,
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: request.maxTokens ?? 16_000 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError("gemini", "unavailable", `Could not reach Gemini: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
    const body = GenerateResponse.safeParse(
      await readJsonCapped(response).catch((e: unknown) => {
        if (e instanceof ResponseTooLargeError) throw new ProviderError("gemini", "invalid_output", e.message);
        return {};
      }),
    );
    if (!response.ok) throw errorFor(response.status, body.success ? (body.data.error?.message ?? "") : "");
    if (!body.success) throw new ProviderError("gemini", "invalid_output", "Gemini returned an unexpected response shape.");
    if (body.data.promptFeedback?.blockReason) throw new ProviderError("gemini", "refusal", `Gemini blocked the request (${body.data.promptFeedback.blockReason}).`);
    const candidate = body.data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") throw new ProviderError("gemini", "truncated", "Gemini's response was cut off before it finished.");
    if (candidate?.finishReason && /SAFETY|RECITATION|BLOCKLIST|PROHIBITED/.test(candidate.finishReason))
      throw new ProviderError("gemini", "refusal", `Gemini stopped for ${candidate.finishReason.toLowerCase()} reasons.`);
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new ProviderError("gemini", "unavailable", "Gemini returned an empty reply.");
    return text;
  }
}
