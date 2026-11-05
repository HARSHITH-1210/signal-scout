import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useInMemoryDbForTests } from "@/lib/db/schema";
import { redact } from "@/lib/config";
import { GeminiProvider, resetGeminiOverloads } from "@/lib/providers/gemini";
import { ExaProvider } from "@/lib/providers/exa";
import { GdeltProvider, gdeltDate, gdeltPhrase } from "@/lib/providers/gdelt";
import { assertPublicUrl, DirectReader, htmlToText, isPrivateAddress, JinaReader } from "@/lib/providers/reader";
import { probeProviders, providerStatus } from "@/lib/providers/status";
import { isDown } from "@/lib/providers/health";

type Call = { url: string; init: RequestInit };
const fakeFetch = (respond: (url: string, init: RequestInit) => Response) => {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, impl };
};
const schema = z.object({ answer: z.string() });
const geminiReply = (text: string, finishReason = "STOP") => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

beforeEach(() => {
  useInMemoryDbForTests();
  resetGeminiOverloads();
});

describe("GeminiProvider", () => {
  it("sends the schema, validates the JSON reply, and never passes tools", async () => {
    const f = fakeFetch(() => geminiReply('{"answer":"yes"}'));
    const gemini = new GeminiProvider("AIzaTEST-key-1234567890abcdef", "gemini-flash-latest", f.impl);
    expect(await gemini.generate({ task: "draft", system: "sys", user: "hi", effort: "low", schema })).toEqual({ answer: "yes" });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(f.calls[0].url).toContain("gemini-flash-latest:generateContent");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.answer).toBeDefined();
    expect(body.tools).toBeUndefined();
    expect(new Headers(f.calls[0].init.headers).get("x-goog-api-key")).toMatch(/^AIza/);
  });

  it("corrects a near-miss reply once", async () => {
    let n = 0;
    const f = fakeFetch(() => geminiReply(n++ === 0 ? '{"wrong":1}' : '{"answer":"fixed"}'));
    const gemini = new GeminiProvider("AIzaTEST-key-1234567890abcdef", "m", f.impl);
    expect(await gemini.generate({ task: "draft", system: "", user: "", effort: "low", schema })).toEqual({ answer: "fixed" });
    expect(f.calls).toHaveLength(2);
  });

  it("classifies daily quota, per-minute limits, safety stops and truncation", async () => {
    const run = (res: Response) => new GeminiProvider("AIzaTEST-key-1234567890abcdef", "m", async () => res).generate({ task: "draft", system: "", user: "", effort: "low", schema });
    await expect(run(Response.json({ error: { message: "Quota exceeded for metric: GenerateRequestsPerDay" } }, { status: 429 }))).rejects.toMatchObject({ kind: "quota" });
    await expect(run(Response.json({ error: { message: "Resource exhausted, try again later" } }, { status: 429 }))).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(run(geminiReply("", "SAFETY"))).rejects.toMatchObject({ kind: "refusal" });
    await expect(run(geminiReply('{"answer":', "MAX_TOKENS"))).rejects.toMatchObject({ kind: "truncated" });
    await expect(run(new Response("{}", { status: 403 }))).rejects.toMatchObject({ kind: "auth" });
  });

  it("retries an overloaded model once, then hands over to the next Gemini model", async () => {
    const f = fakeFetch((url) =>
      url.includes("gemini-flash-latest:")
        ? Response.json({ error: { code: 503, message: "This model is currently experiencing high demand." } }, { status: 503 })
        : geminiReply('{"answer":"from lite"}'),
    );
    const gemini = new GeminiProvider("AIzaTEST-key-1234567890abcdef", "gemini-flash-latest", f.impl, ["gemini-flash-lite-latest"], 0);
    expect(await gemini.generate({ task: "draft", system: "", user: "", effort: "low", schema })).toEqual({ answer: "from lite" });
    expect(f.calls.map((c) => c.url.split("/models/")[1].split(":")[0])).toEqual(["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest"]);
    expect(gemini.lastModel).toBe("gemini-flash-lite-latest");
    // The busy model is remembered: the next call goes straight to the backup.
    await gemini.generate({ task: "draft", system: "", user: "", effort: "low", schema });
    expect(f.calls.at(-1)!.url).toContain("gemini-flash-lite-latest:");
    expect(f.calls).toHaveLength(4);
  });

  it("skips a retired model straight away, and reports overload when every model is busy", async () => {
    const retired = fakeFetch((url) => (url.includes("old-model:") ? Response.json({ error: { message: "no longer available" } }, { status: 404 }) : geminiReply('{"answer":"ok"}')));
    expect(await new GeminiProvider("AIzaTEST-key-1234567890abcdef", "old-model", retired.impl, ["new-model"], 0).generate({ task: "draft", system: "", user: "", effort: "low", schema })).toEqual({ answer: "ok" });
    expect(retired.calls).toHaveLength(2);
    const busy = new GeminiProvider("AIzaTEST-key-1234567890abcdef", "a", async () => Response.json({ error: { message: "high demand" } }, { status: 503 }), ["b"], 0);
    await expect(busy.generate({ task: "draft", system: "", user: "", effort: "low", schema })).rejects.toThrow(/overloaded/);
  });

  it("redacts Google API keys", () => {
    expect(redact("key=AIzaSyA1234567890abcdefghijklmno used")).not.toMatch(/AIzaSy/);
  });
});

describe("ExaProvider", () => {
  it("maps results with text and dates, and reads pages", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/search")
        ? Response.json({ results: [{ url: "https://a.com/x", title: "A", text: "Body text", publishedDate: "2026-10-01T00:00:00.000Z", score: 0.8 }] })
        : Response.json({ results: [{ url: "https://a.com/x", text: "Full page" }] }),
    );
    const exa = new ExaProvider("exa-key", f.impl);
    const [r] = await exa.search({ query: "q", topic: "news", startDate: "2026-01-01", maxResults: 3 });
    expect(r).toMatchObject({ url: "https://a.com/x", rawContent: "Body text", publishedDate: "2026-10-01T00:00:00.000Z" });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ category: "news", numResults: 3, startPublishedDate: "2026-01-01T00:00:00.000Z" });
    expect(await exa.extract(["https://a.com/x"])).toEqual([{ url: "https://a.com/x", rawContent: "Full page" }]);
  });

  it("treats used-up credits as quota", async () => {
    await expect(new ExaProvider("k", async () => new Response("{}", { status: 402 })).search({ query: "q" })).rejects.toMatchObject({ kind: "quota" });
  });
});

describe("GDELT (keyless news)", () => {
  it("searches the subject phrase, reads the top articles, and keeps dates", async () => {
    const f = fakeFetch(() =>
      Response.json({
        articles: [
          { url: "https://news.example/1", title: "Northwind Freight expands", seendate: "20261101T093000Z", language: "English" },
          { url: "https://news.example/2", title: "Northwind Freight hires", seendate: "20261020T120000Z", language: "English" },
        ],
      }),
    );
    const reader = { extract: async (urls: string[]) => urls.slice(0, 1).map((url) => ({ url, rawContent: "Article body" })) };
    const gdelt = new GdeltProvider(reader, f.impl, 0);
    const results = await gdelt.search({ query: "Northwind Freight news announcement", subject: "Northwind Freight" });
    expect(new URL(f.calls[0].url).searchParams.get("query")).toBe('"Northwind Freight" sourcelang:english');
    expect(results[0]).toMatchObject({ rawContent: "Article body", publishedDate: "2026-11-01T09:30:00Z" });
    expect(results[1]).toMatchObject({ rawContent: "Northwind Freight hires" }); // headline only, still verifiable
    await gdelt.search({ query: "other", subject: "Northwind Freight" });
    expect(f.calls).toHaveLength(1); // cached per subject
  });

  it("turns GDELT's plain-text complaints into a clear error", async () => {
    const gdelt = new GdeltProvider(null, async () => new Response("Your search contained a phrase that was too short."), 0);
    await expect(gdelt.search({ query: "x", subject: "Northwind" })).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("parses dates and phrases", () => {
    expect(gdeltDate("20261105T120000Z")).toBe("2026-11-05T12:00:00Z");
    expect(gdeltPhrase({ query: '"Priya Raman" Northwind interview' })).toBe("Priya Raman");
  });
});

describe("page readers", () => {
  it("blocks private, loopback, link-local and metadata addresses", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
      expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    await expect(assertPublicUrl("http://internal.corp/x", async () => ["10.0.0.5"])).rejects.toThrow(/private network/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http and https/);
    await expect(assertPublicUrl("http://user:pw@example.com")).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl("https://example.com/a", async () => ["93.184.216.34"])).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect, so a public page can't bounce the reader to an internal one", async () => {
    const resolve = async (host: string) => (host === "evil.example" ? ["93.184.216.34"] : ["127.0.0.1"]);
    const reader = new DirectReader(async () => new Response(null, { status: 302, headers: { location: "http://localhost:8080/admin" } }), resolve);
    await expect(reader.extract(["https://evil.example/go"])).rejects.toThrow(/private network/);
  });

  it("reads HTML as text", async () => {
    const reader = new DirectReader(
      async () => new Response("<html><script>x()</script><h1>Hello</h1><p>Team &amp; growth</p></html>", { headers: { "content-type": "text/html" } }),
      async () => ["93.184.216.34"],
    );
    expect(await reader.extract(["https://example.com"])).toEqual([{ url: "https://example.com", rawContent: "Hello\nTeam & growth" }]);
    expect(htmlToText("<style>a{}</style>A&#39;s")).toBe("A's");
  });

  it("Jina Reader fetches through r.jina.ai and reports its limits", async () => {
    const f = fakeFetch(() => new Response("Page text"));
    expect(await new JinaReader(null, f.impl).extract(["https://example.com/a"])).toEqual([{ url: "https://example.com/a", rawContent: "Page text" }]);
    expect(f.calls[0].url).toBe("https://r.jina.ai/https://example.com/a");
    await expect(new JinaReader(null, async () => new Response("", { status: 429 })).extract(["https://example.com"])).rejects.toMatchObject({ kind: "rate_limit" });
  });
});

describe("System status and connection tests", () => {
  it("lists every provider with its place in the chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.GEMINI_API_KEY = "AIzaTEST-key-1234567890abcdef";
    process.env.TAVILY_API_KEY = "tvly-test-key-123456";
    process.env.LLM_PROVIDER = "openrouter";
    try {
      const status = providerStatus();
      expect(status.find((p) => p.name === "openrouter")).toMatchObject({ position: "primary", state: "up" });
      expect(status.find((p) => p.name === "gemini")).toMatchObject({ position: "fallback 1", configured: true });
      expect(status.find((p) => p.name === "exa")).toMatchObject({ configured: false, state: "off" });
      expect(status.find((p) => p.name === "gdelt")).toMatchObject({ configured: true, position: "keyless fallback" });
    } finally {
      for (const k of ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "TAVILY_API_KEY", "LLM_PROVIDER"]) delete process.env[k];
    }
  });

  it("probes keys without spending tokens, and a rejected key pauses the provider", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.GEMINI_API_KEY = "AIzaTEST-key-1234567890abcdef";
    try {
      const results = await probeProviders(async (url) =>
        url.includes("openrouter")
          ? Response.json({ data: { limit_remaining: null, is_free_tier: true } })
          : new Response("{}", { status: 403 }),
      );
      expect(results.find((r) => r.name === "openrouter")).toMatchObject({ ok: true });
      expect(results.find((r) => r.name === "gemini")).toMatchObject({ ok: false, detail: "The key was rejected." });
      expect(isDown("gemini").down).toBe(true);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.GEMINI_API_KEY;
    }
  });
});
