import { describe, expect, it } from "vitest";
import { diffWords } from "@/lib/ui/diff";

describe("diffWords", () => {
  it("returns one unchanged part for identical text", () => {
    expect(diffWords("hello there", "hello there")).toEqual([{ kind: "same", text: "hello there" }]);
  });

  it("marks replaced words as removed then added", () => {
    const parts = diffWords("the quick fox", "the slow fox");
    expect(parts).toEqual([
      { kind: "same", text: "the " },
      { kind: "removed", text: "quick " },
      { kind: "added", text: "slow " },
      { kind: "same", text: "fox" },
    ]);
  });

  it("rebuilds both sides from the parts", () => {
    const before = "Hi Priya, congrats on the new office.\nWorth a chat?";
    const after = "Hi Priya, congratulations on the Lisbon office.\nOpen to a short chat?";
    const parts = diffWords(before, after);
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe(before);
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe(after);
  });
});
