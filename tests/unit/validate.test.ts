import { describe, expect, it } from "vitest";
import { validateClarification, validateProspect, validateSenderProfile } from "@/lib/pipeline/validate";
import { DEFAULT_SENDER_PROFILE } from "@/lib/db/repo";

describe("validateProspect", () => {
  it("accepts a name plus company and trims fields", () => {
    const r = validateProspect({ name: "  Priya Raman ", company: "Northwind Freight", role: "" });
    expect(r).toEqual({ ok: true, value: { name: "Priya Raman", company: "Northwind Freight" } });
  });

  it("normalises a bare website domain and a LinkedIn URL without scheme", () => {
    const r = validateProspect({ name: "Priya Raman", companyWebsite: "northwindfreight.com", linkedinUrl: "linkedin.com/in/priya-raman" });
    expect(r.ok && r.value.companyWebsite).toBe("https://northwindfreight.com");
    expect(r.ok && r.value.linkedinUrl).toBe("https://linkedin.com/in/priya-raman");
  });

  it.each([
    [{}, "_form"],
    [{ name: "   ", company: "" }, "_form"],
    [{ name: "P" }, "name"],
    [{ name: "12345", company: "Acme" }, "name"],
    [{ name: "Priya Raman", companyWebsite: "not a url" }, "companyWebsite"],
    [{ name: "Priya Raman", linkedinUrl: "https://linkedin.com/company/acme" }, "linkedinUrl"],
    [{ name: "Priya Raman", linkedinUrl: "https://evil.com/in/priya" }, "linkedinUrl"],
    [{ name: "Priya Raman", company: "x".repeat(121) }, "company"],
  ])("rejects %j with an error on %s", (input, field) => {
    const r = validateProspect(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toContain(field);
  });

  it.each([[{ name: "Priya Raman" }], [{ company: "Ramp" }], [{ companyWebsite: "ramp.com" }], [{ linkedinUrl: "linkedin.com/in/priya-raman" }], [{ role: "CFO" }], [{ notes: "the Austin robotics startup" }]])(
    "accepts a single field on its own: %j",
    (input) => {
      expect(validateProspect(input).ok).toBe(true);
    },
  );

  it("rejects non-object input", () => {
    expect(validateProspect(null).ok).toBe(false);
    expect(validateProspect("Priya").ok).toBe(false);
  });
});

describe("validateClarification", () => {
  it("accepts a candidate pick or extra details, rejects an empty clarification", () => {
    expect(validateClarification({ candidateIndex: 1 }).ok).toBe(true);
    expect(validateClarification({ companyWebsite: "atlasrobotics.io" }).ok).toBe(true);
    expect(validateClarification({}).ok).toBe(false);
    expect(validateClarification({ candidateIndex: -1 }).ok).toBe(false);
  });
});

describe("validateSenderProfile", () => {
  it("accepts the default profile, blank or missing fields, and rejects overlong ones", () => {
    expect(validateSenderProfile(DEFAULT_SENDER_PROFILE).ok).toBe(true);
    expect(validateSenderProfile({ ...DEFAULT_SENDER_PROFILE, offering: "  " })).toEqual({ ok: true, value: { ...DEFAULT_SENDER_PROFILE, offering: "" } });
    expect(validateSenderProfile({}).ok).toBe(true);
    const r = validateSenderProfile({ ...DEFAULT_SENDER_PROFILE, senderName: "x".repeat(81) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["senderName"]);
  });
});
