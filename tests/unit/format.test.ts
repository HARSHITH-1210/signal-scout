import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/ui/format";

describe("formatDate", () => {
  it("shows only the precision the source provided", () => {
    expect(formatDate("2025")).toBe("2025");
    expect(formatDate("2026-07")).toMatch(/Jul.*2026/);
    expect(formatDate("2026-07")).not.toMatch(/\b1\b/);
    expect(formatDate("2026-09-10")).toMatch(/10/);
    expect(formatDate(null)).toBe("No date");
    expect(formatDate("garbage")).toBe("garbage");
  });
});
