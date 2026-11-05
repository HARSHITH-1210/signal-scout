import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/providers/llm";
import { TavilyProvider } from "@/lib/providers/search";
import { ProviderError } from "@/lib/errors";

describe("real providers", () => {
  it("refuse to construct without credentials", () => {
    expect(() => new AnthropicProvider(null)).toThrowError(ProviderError);
    expect(() => new TavilyProvider(null)).toThrowError(/TAVILY_API_KEY is not set/);
  });
});
