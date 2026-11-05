import { afterEach, describe, expect, it } from "vitest";
import { getHealth, redact } from "@/lib/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("config", () => {
  it("redacts configured keys and key-shaped strings", () => {
    process.env.TAVILY_API_KEY = "tvly-supersecretvalue123";
    process.env.ANTHROPIC_API_KEY = "custom-anthropic-key-without-prefix";
    const out = redact(
      "auth failed for tvly-supersecretvalue123 and custom-anthropic-key-without-prefix; header Bearer abcdefghijklmnop; sk-ant-api03-zzzzzzzzzzzz",
    );
    expect(out).not.toMatch(/supersecret|custom-anthropic|abcdefghijklmnop|zzzzzzzz/);
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("reports key presence as booleans only", () => {
    process.env.TAVILY_API_KEY = "tvly-supersecretvalue123";
    delete process.env.ANTHROPIC_API_KEY;
    const health = getHealth();
    expect(health).toMatchObject({ tavilyConfigured: true, anthropicConfigured: false });
    expect(JSON.stringify(health)).not.toContain("tvly-");
  });
});
