import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getConfig, getHealth, missingSettings, redact } from "@/lib/config";
import { ProviderError } from "@/lib/errors";
import { extractJson, OpenRouterProvider } from "@/lib/providers/openrouter";
import { createLlmProvider } from "@/lib/pipeline/runner";

const Schema = z.object({ status: z.enum(["ok", "no"]), note: z.string().nullable() });
const request = { task: "draft" as const, system: "sys", user: "usr", schema: Schema, effort: "low" as const };

type Call = { url: string; body: Record<string, unknown> };
function fakeFetch(replies: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  };
  return { impl, calls };
}
const reply = (content: string, finish_reason = "stop") => ({ json: { choices: [{ message: { content }, finish_reason }] } });

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("OpenRouterProvider", () => {
  it("sends a strict JSON-schema request routed only to supporting providers, and parses the reply", async () => {
    const { impl, calls } = fakeFetch([reply('{"status":"ok","note":null}')]);
    const out = await new OpenRouterProvider("sk-or-v1-testkey123456", "some/model:free", impl).generate(request);
    expect(out).toEqual({ status: "ok", note: null });
    const body = calls[0].body as { model: string; provider: unknown; response_format: { json_schema: { strict: boolean; schema: Record<string, unknown> } } };
    expect(body.model).toBe("some/model:free");
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("tools");
  });

  it("asks once for a correction when the reply doesn't match the schema, then gives up clearly", async () => {
    const ok = fakeFetch([reply('{"status":"maybe"}'), reply('```json\n{"status":"no","note":"x"}\n```')]);
    expect(await new OpenRouterProvider("k-123456789", "m", ok.impl).generate(request)).toEqual({ status: "no", note: "x" });
    expect(JSON.stringify(ok.calls[1].body)).toMatch(/did not match the required JSON schema/);

    const bad = fakeFetch([reply("not json"), reply("still not json")]);
    await expect(new OpenRouterProvider("k-123456789", "m", bad.impl).generate(request)).rejects.toThrow(/didn't match the expected format/);
  });

  it.each([
    [401, "", /OPENROUTER_API_KEY/],
    [402, "", /insufficient credits/],
    [404, "No endpoints found that support structured outputs", /supports structured outputs/],
    [429, "Rate limit exceeded: free-models-per-day", /daily limit/],
  ])("maps HTTP %i to a clear, non-retried error", async (status, message, expected) => {
    const { impl, calls } = fakeFetch([{ status, json: { error: { code: status, message } } }]);
    await expect(new OpenRouterProvider("k-123456789", "m", impl).generate(request)).rejects.toThrow(expected);
    expect(calls).toHaveLength(1);
  });

  it("retries an empty reply as transient", async () => {
    const { impl, calls } = fakeFetch([reply("   "), reply('{"status":"ok","note":null}')]);
    expect(await new OpenRouterProvider("k-123456789", "m", impl).generate(request)).toEqual({ status: "ok", note: null });
    expect(calls).toHaveLength(2);
  }, 20_000);

  it("reports truncation and provider-side errors returned with HTTP 200", async () => {
    await expect(new OpenRouterProvider("k-123456789", "m", fakeFetch([reply('{"sta', "length")]).impl).generate(request)).rejects.toThrow(/cut off/);
    await expect(new OpenRouterProvider("k-123456789", "m", fakeFetch([{ json: { error: { code: 400, message: "bad schema" } } }]).impl).generate(request)).rejects.toThrow(/rejected the request/);
  });

  it("refuses to construct without a key", () => {
    expect(() => new OpenRouterProvider(null)).toThrowError(ProviderError);
  });

  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => extractJson("no braces")).toThrow();
  });
});

describe("provider selection", () => {
  it("infers OpenRouter when it's the only LLM key, and LLM_PROVIDER overrides", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijkl";
    expect(getConfig().llmProvider).toBe("openrouter");
    expect(createLlmProvider()).toBeInstanceOf(OpenRouterProvider);

    process.env.ANTHROPIC_API_KEY = "sk-ant-abcdefghijkl";
    expect(getConfig().llmProvider).toBe("anthropic");
    process.env.LLM_PROVIDER = "OpenRouter";
    expect(getConfig().llmProvider).toBe("openrouter");
  });

  it("flags an unknown LLM_PROVIDER instead of guessing", () => {
    process.env.LLM_PROVIDER = "gemini";
    expect(getHealth().llmProvider).toBe("invalid");
    expect(missingSettings().join(" ")).toMatch(/LLM_PROVIDER/);
    expect(() => createLlmProvider()).toThrow(/must be "anthropic" or "openrouter"/);
  });

  it("reports the active provider's key and model, never values", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENROUTER_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijkl";
    process.env.TAVILY_API_KEY = "tvly-abcdefghijkl";
    const health = getHealth();
    expect(health).toMatchObject({ llmProvider: "openrouter", llmConfigured: true, tavilyConfigured: true, model: "nvidia/nemotron-3.5-super-vl:free" });
    expect(missingSettings()).toEqual([]);
    expect(JSON.stringify(health)).not.toMatch(/sk-or|tvly-/);
    expect(redact("key sk-or-v1-abcdefghijkl")).not.toContain("abcdefghijkl");
  });
});
