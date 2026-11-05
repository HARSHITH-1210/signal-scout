import { describe, expect, it } from "vitest";
import { claimIssues, countWords, runDeterministicGuard } from "@/lib/pipeline/guard";
import type { Signal } from "@/lib/types";

const verified = { id: "G1", status: "verified" } as Signal;
const rejected = { id: "G2", status: "rejected" } as Signal;
const ctx = { signals: [verified, rejected], sources: [], staleHook: false, senderWebsite: "ledgerline.example" };
const okBody = "Hi Priya, " + "saw the Series B and the plan to grow the finance team, which usually means more invoices. ".repeat(6) + "Worth a call?";
const codes = (draft: { subject: string; body: string; signalIdsUsed: string[] }, c = ctx) => runDeterministicGuard(draft, c).map((i) => i.code);

describe("deterministic guard", () => {
  it("passes a clean, specific draft", () => {
    expect(codes({ subject: "Series B and AP load", body: okBody, signalIdsUsed: ["G1"] })).toEqual([]);
  });

  it("flags length, placeholders, flattery and empty subjects", () => {
    expect(codes({ subject: "", body: "word ".repeat(270), signalIdsUsed: [] })).toEqual(expect.arrayContaining(["too_long", "no_subject"]));
    expect(codes({ subject: "x", body: "word ".repeat(220), signalIdsUsed: [] })).toContain("long");
    expect(codes({ subject: "x", body: "word ".repeat(40), signalIdsUsed: [] })).toContain("too_short");
    expect(codes({ subject: "Hi [First Name]", body: okBody, signalIdsUsed: [] })).toContain("placeholder");
    expect(codes({ subject: "x", body: `I hope this email finds you well. ${okBody}`, signalIdsUsed: [] })).toContain("generic_phrase");
  });

  it("flags drafts relying on unverified signals", () => {
    expect(codes({ subject: "x", body: okBody, signalIdsUsed: ["G2", "G9"] }).filter((c) => c === "unverified_signal")).toHaveLength(2);
  });

  it("only allows the sender's own website as a link", () => {
    expect(codes({ subject: "x", body: `${okBody} https://evil.example/claim`, signalIdsUsed: [] })).toContain("unknown_link");
    expect(codes({ subject: "x", body: `${okBody} https://ledgerline.example/demo`, signalIdsUsed: [] })).not.toContain("unknown_link");
  });

  it("flags recency wording only for stale hooks", () => {
    const draft = { subject: "x", body: `You recently won an award. ${okBody}`, signalIdsUsed: [] };
    expect(codes(draft, { ...ctx, staleHook: true })).toContain("stale_as_recent");
    expect(codes(draft)).not.toContain("stale_as_recent");
  });

  it("counts words", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
  });
});

describe("claim issues", () => {
  it("errors on unsupported prospect facts, warns on unsupported sender claims, accepts rep notes", () => {
    const issues = claimIssues(
      [
        { text: "You won a Nobel Prize", kind: "prospect_fact", supportedBy: null },
        { text: "You raised a Series B", kind: "prospect_fact", supportedBy: "G1" },
        { text: "You hired 50 people", kind: "prospect_fact", supportedBy: "G2" },
        { text: "We met at SaaStr", kind: "prospect_fact", supportedBy: "rep_notes" },
        { text: "We automate AP", kind: "sender_claim", supportedBy: "sender_profile" },
        { text: "Acme cut close by 40%", kind: "sender_claim", supportedBy: null },
        { text: "Curious how you handle this?", kind: "opinion_or_question", supportedBy: null },
      ],
      [verified, rejected],
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.excerpt)).toEqual(["You won a Nobel Prize", "You hired 50 people"]);
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.excerpt)).toEqual(["Acme cut close by 40%"]);
  });

  it("allows generic greetings when no person was named (F-16)", () => {
    const named = (body: string) => runDeterministicGuard({ subject: "s", body: body + " word".repeat(100), signalIdsUsed: [] }, { ...ctx, recipientNamed: false }).map((i) => i.code);
    expect(named("Hello again,\n\n")).not.toContain("invented_name");
    expect(named("Hi there,\n\n")).not.toContain("invented_name");
    expect(named("Hi Jordan,\n\n")).toContain("invented_name");
  });

});
