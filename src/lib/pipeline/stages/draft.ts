import { z } from "zod";
import { relevantChunks } from "../../documents/parse";
import type { ClaimCheck, DraftKind, DraftNotes, GuardReport, Hook, Identity, PitchedOffering, ProspectInput, RunPitch, SenderProfile, Signal, Source } from "../../types";
import { pitchFocus } from "../pitch";
import type { StageContext } from "../context";
import { buildGuardReport, claimIssues, runDeterministicGuard, TARGET_MAX_WORDS, TARGET_MIN_WORDS } from "../guard";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "../sanitize";

/** Seller material (sender-profile documents) passed to the drafter and the claim audit. */
export interface SellerDocument {
  name: string;
  text: string;
}

const DraftOutput = z.object({
  subject: z.string(),
  alternateSubjects: z.array(z.string()),
  greeting: z.string(),
  opening: z.string(),
  insight: z.string(),
  value: z.string(),
  alsoOffer: z.string().nullable(),
  cta: z.string(),
  postscript: z.string().nullable(),
  signoff: z.string(),
  signalIdsUsed: z.array(z.string()),
  recipientHint: z.string().nullable(),
  rationale: z.array(z.string()),
});
type DraftOutput = z.infer<typeof DraftOutput>;

const STRUCTURE = `Structure (each part is its own short paragraph, ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS - 20} words in total):
- greeting: "Hi <first name>," or, if no name is given, "Hi there,". Never invent or guess a name.
- opening (2-3 sentences): the hook, stated exactly as its QUOTE supports, with its timeframe when known. Make it obvious this was written for this company, not a template.
- insight (2-3 sentences): what this likely means for someone in the prospect's role, framed as your hypothesis or a question ("teams expanding lanes usually…", "I'd guess…"), not as a fact about them. Use a supporting finding here if it sharpens the point.
- value (2-3 sentences): the LEAD OFFERING only, said concretely for this situation. Draw only on the SELLER PROFILE and SELLER MATERIAL. A proof point (customer, metric, result) may appear only if it is stated in the SELLER MATERIAL.
- alsoOffer: when ALSO OFFERS lists anything, one short sentence that names those offerings in passing (e.g. "We also help teams with X and Y."), with no detail or claims; otherwise null.
- cta (1 sentence): one low-friction ask, phrased as a question, based on the preferred call to action.
- postscript: optional. A one-line P.S. using a second verified finding, or null.
- signoff: e.g. "Best,\\n<sender first name>" (no name if none is set).`;

const STYLE = `Style:
- Plain text, sounds like a thoughtful peer. No flattery, buzzwords, exclamation marks, links, phone numbers or placeholders like [Name].
- subject: 3-8 words, specific to this prospect, no clickbait. alternateSubjects: two other options in different angles.
- rationale: 2-4 short notes for the sales rep explaining your choices (which finding you led with and why, what you deliberately left out).
- recipientHint: when no prospect name is given, the job title(s) this is best sent to (e.g. "CFO or VP Finance"); otherwise null.`;

const PERSONALISED_SYSTEM = `You write first-touch B2B outreach emails grounded strictly in verified research.
${UNTRUSTED_DATA_RULE}
${STRUCTURE}
${STYLE}
Grounding rules:
- Facts about the prospect or their company may only come from the QUOTES of the findings provided, or the rep's own notes. Each finding's summary is a convenience; when it says more than its quote, the quote wins.
- A finding marked "date unknown" or with freshness "stale" must never be described as recent, new or "just".
- signalIdsUsed: ids of every finding whose facts you used.
- Never mention layoffs, breaches, lawsuits, investigations or other bad news about the prospect, even if you know of it.
- Never open with congratulations on a funding round or award: every other seller sends that. Lead with what the event changes for this person's role.
- Never state the prospect's problems, struggles or feelings as fact. State only what was observed, then ask about the implication ("Saw you're hiring X. Is that for new work or to ease the load on the team?").`;

const ROLE_BASED_SYSTEM = `You write a first-touch B2B outreach email WITHOUT personalised research, because no verified finding was available.
${UNTRUSTED_DATA_RULE}
${STRUCTURE.replace("the hook, stated exactly as its QUOTE supports, with its timeframe when known", "a specific, relevant observation about the challenges of the prospect's role (not a fact about them)")}
${STYLE}
Grounding rules:
- Do not mention any news, event, funding, hiring, launch, quote or other specific fact about the prospect or their company. Only their name, company name, role, and the rep's own notes may appear.
- postscript must be null. signalIdsUsed must be an empty array.`;

/** One finding as the drafter sees it: the quote is authoritative, the rest is context. */
export function findingBlock(signal: Signal, source: Source | undefined, label: string): string {
  const date = signal.eventDate ?? source?.publishedDate ?? null;
  return [
    `${label} ${signal.id} (${signal.type}, about the ${signal.about}; ${source?.origin === "prospect_document" ? "from the rep's own document" : `from ${source?.domain ?? "unknown"}`})`,
    `  QUOTE (authoritative): "${signal.evidenceQuote}"`,
    `  Summary: ${signal.claim}`,
    `  Date: ${date ?? "date unknown"} | freshness: ${signal.freshness}`,
    `  Why it may matter (inference, not fact): ${signal.whyItMatters}`,
    signal.offerLink ? `  Link to the offer (inference, not fact): ${signal.offerLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const NOT_SET = "(not set: keep this general and make no specific claims)";

/** Which pitched offering a draft leads with, and which it only names. */
export interface PitchFocus {
  lead: PitchedOffering | null;
  others: PitchedOffering[];
}

/** Every pitched offering with its details: for the claim audit and for revisions that may switch the lead. */
export function fullFocus(pitch: RunPitch, lead?: PitchedOffering | null): PitchFocus {
  const first = lead ?? pitch.offerings[0] ?? null;
  return { lead: first, others: pitch.offerings.filter((o) => o.id !== first?.id) };
}

const describeOffering = (o: PitchedOffering) => `${o.name}: ${o.whatItDoes || "(no description)"}`;

/**
 * The seller profile as prompt text. "draft" details only the lead offering and names the others;
 * "full" details every pitched offering (claim audit, revisions).
 */
export function senderBlock(sender: SenderProfile, focus: PitchFocus, mode: "draft" | "full" = "draft"): string {
  const who = [sender.senderName, sender.senderRole && sender.companyName ? `${sender.senderRole} at ${sender.companyName}` : sender.senderRole || sender.companyName]
    .filter(Boolean)
    .join(", ");
  const lines = ["SELLER PROFILE (written by the rep; authoritative for claims about the seller):", `  Sender: ${who || "(not set: sign off without a name)"}`];
  if (!focus.lead) lines.push(`  Offering: ${NOT_SET}`, "  ALSO OFFERS: (none: alsoOffer must be null)");
  else if (mode === "full")
    lines.push("  Offerings (the email currently leads with the first):", ...[focus.lead, ...focus.others].map((o) => `    - ${describeOffering(o)}`));
  else
    lines.push(
      `  LEAD OFFERING (the value paragraph is about this one only): ${describeOffering(focus.lead)}`,
      focus.others.length
        ? `  ALSO OFFERS (name these in passing in alsoOffer; no details, no claims): ${focus.others.map((o) => o.name).join("; ")}`
        : "  ALSO OFFERS: (none: alsoOffer must be null)",
    );
  lines.push(`  Preferred call to action: ${focus.lead?.cta || sender.defaultCta || "a short call to compare notes"}`);
  return lines.join("\n");
}

/** The parts of the seller's documents most relevant to this prospect, wrapped as data. */
export function sellerMaterialBlock(docs: SellerDocument[], query: string): string {
  if (docs.length === 0) return "SELLER MATERIAL: (none uploaded)";
  const blocks = docs.slice(0, 4).flatMap((doc, d) =>
    relevantChunks(doc.text, query, 2, 1200).map((chunk, i) =>
      wrapUntrusted({ id: `M${d + 1}.${i + 1}`, url: `upload://${doc.name}`, title: doc.name, publishedDate: null, text: chunk }),
    ),
  );
  return `SELLER MATERIAL (the seller's own documents; use only for claims about the seller):\n${blocks.slice(0, 5).join("\n\n")}`;
}

/** The prospect (name, role, company, rep notes) as prompt text. */
export function prospectBlock(prospect: ProspectInput, identity: Identity | null): string {
  const name = identity?.resolvedName ?? prospect.name;
  return [
    `PROSPECT: ${name ?? "NOT SPECIFIED. Write to the leader at this company most relevant to the seller's offering, greet with \"Hi there,\" and never invent a name."}`,
    `ROLE: ${identity?.resolvedRole ?? prospect.role ?? "unknown"}`,
    `COMPANY: ${identity?.resolvedCompany ?? prospect.company ?? "unknown"}`,
    identity?.companyDescription ? `COMPANY CONTEXT (background, not quotable): ${identity.companyDescription}` : "",
    prospect.notes ? `REP'S OWN NOTES (true, may be referenced): ${prospect.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Joins the structured parts into the email body the rep edits. */
export function assembleBody(output: Pick<DraftOutput, "greeting" | "opening" | "insight" | "value" | "cta" | "postscript" | "signoff"> & { alsoOffer?: string | null }): string {
  return [output.greeting, output.opening, output.insight, [output.value, output.alsoOffer ?? ""].map((p) => p.trim()).filter(Boolean).join(" "), output.cta, output.signoff, output.postscript ? `P.S. ${output.postscript.replace(/^P\.?S\.?\s*/i, "")}` : ""]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

const ClaimOutput = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["prospect_fact", "sender_claim", "opinion_or_question"]),
      supportedBy: z.string().nullable(),
    }),
  ),
});

const CLAIM_SYSTEM = `You audit a sales email for unsupported factual claims.
${UNTRUSTED_DATA_RULE}
List every factual statement in the email. Classify each:
- prospect_fact: any statement of fact about the prospect, their company, their team, or events involving them. supportedBy = the id of the finding whose QUOTE directly states it, "rep_notes" if the rep's notes state it, or null. Be strict: extra details (numbers, purposes, adjectives like "record") not in the quote are NOT supported. A date is supported when it matches the finding's listed date.
- sender_claim: statements about the seller's own company, product, customers or results. supportedBy = "sender_profile" or "seller_documents" if stated there, else null.
- opinion_or_question: questions, hypotheses, or opinions ("teams in your position often...", "curious whether...").`;

export interface DraftResult {
  kind: DraftKind;
  subject: string;
  body: string;
  signalIdsUsed: string[];
  guard: GuardReport;
}

type GeneratedDraft = {
  kind: DraftKind;
  subject: string;
  body: string;
  signalIdsUsed: string[];
  recipientHint: string | null;
  notes: DraftNotes;
};

/** Verified, dated, non-stale findings that can sharpen a draft beyond its hook. */
export function supportingFindings(signals: Signal[], hook: Hook, limit = 3): Signal[] {
  const ranked = [...hook.alternativeSignalIds, ...signals.map((s) => s.id)];
  const seen = new Set<string>([hook.signalId]);
  const out: Signal[] = [];
  for (const id of ranked) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = signals.find((x) => x.id === id);
    if (s && s.status === "verified" && !s.sensitive && s.freshness !== "stale" && (s.score ?? 0) > 0.15) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Generates a structured draft (personalised from the hook, or explicitly role-based). */
export async function generateDraft(
  ctx: StageContext,
  input: {
    kind: DraftKind;
    prospect: ProspectInput;
    identity: Identity | null;
    hook: Hook | null;
    signals: Signal[];
    sources: Source[];
    sellerDocuments?: SellerDocument[];
  },
): Promise<{ draft: GeneratedDraft; guardInput: GuardInput }> {
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const sellerDocs = input.sellerDocuments ?? [];
  const hookSignalForPitch = input.kind === "personalised" ? input.signals.find((s) => s.id === input.hook?.signalId) : undefined;
  const focus: PitchFocus = pitchFocus(ctx.pitch, hookSignalForPitch, input.kind === "personalised" ? input.signals : []);
  let user: string;
  let system: string;

  if (input.kind === "personalised") {
    if (!input.hook) throw new Error("A personalised draft requires a selected hook.");
    const hookSignal = input.signals.find((s) => s.id === input.hook!.signalId);
    if (!hookSignal || hookSignal.status !== "verified") throw new Error("The selected hook is not a verified signal.");
    const supporting = supportingFindings(input.signals, input.hook);
    system = PERSONALISED_SYSTEM;
    user = [
      senderBlock(ctx.sender, focus),
      "",
      sellerMaterialBlock(sellerDocs, `${hookSignal.evidenceQuote} ${hookSignal.whyItMatters} ${input.identity?.resolvedRole ?? input.prospect.role ?? ""}`),
      "",
      prospectBlock(input.prospect, input.identity),
      "",
      findingBlock(hookSignal, sourceById.get(hookSignal.sourceId), "HOOK"),
      input.hook.staleCaveat
        ? `NOTE: the hook is stale for a ${hookSignal.type.replace(/_/g, " ")} signal (${hookSignal.ageDays ?? "?"} days old). Refer to it with its timeframe and never call it recent, new or "just" happened.`
        : "",
      ...supporting.map((s) => findingBlock(s, sourceById.get(s.sourceId), "SUPPORTING (optional)")),
    ].join("\n");
  } else {
    system = ROLE_BASED_SYSTEM;
    user = [
      senderBlock(ctx.sender, focus),
      "",
      sellerMaterialBlock(sellerDocs, `${input.identity?.resolvedRole ?? input.prospect.role ?? ""} ${input.prospect.notes ?? ""}`),
      "",
      prospectBlock(input.prospect, input.identity),
    ].join("\n");
  }

  ctx.emit("draft", "running", input.kind === "personalised" ? "Writing a structured draft around the selected hook" : "Writing a clearly labelled role-based draft");
  const output = await ctx.deps.llm.generate({ task: "draft", effort: "medium", system, user, schema: DraftOutput });
  const signalIdsUsed = input.kind === "role_based" ? [] : [...new Set(output.signalIdsUsed)];
  const draft: GeneratedDraft = {
    kind: input.kind,
    subject: output.subject.trim(),
    body: assembleBody({ ...(input.kind === "role_based" ? { ...output, postscript: null } : output), alsoOffer: focus.others.length ? output.alsoOffer : null }),
    signalIdsUsed,
    recipientHint: output.recipientHint?.trim() || null,
    notes: {
      alternateSubjects: output.alternateSubjects.map((s) => s.trim()).filter(Boolean).slice(0, 3),
      rationale: output.rationale.map((s) => s.trim()).filter(Boolean).slice(0, 5),
      pitch: { lead: focus.lead?.name ?? null, others: focus.others.map((o) => o.name) },
    },
  };
  return { draft, guardInput: buildGuardInput({ ...input, sellerDocuments: sellerDocs }, signalIdsUsed) };
}

/** What the guard needs to check a draft that relies on `signalIdsUsed`. */
export function buildGuardInput(
  input: {
    kind: DraftKind;
    prospect: ProspectInput;
    identity: Identity | null;
    hook: Hook | null;
    signals: Signal[];
    sources: Source[];
    sellerDocuments: SellerDocument[];
    repNotes?: string | null;
  },
  signalIdsUsed: string[],
): GuardInput {
  // Recency wording is checked against every stale finding the draft relies on, not only the hook.
  const staleUsed = input.signals.some((s) => signalIdsUsed.includes(s.id) && s.freshness === "stale");
  return {
    signals: input.signals,
    sources: input.sources,
    staleHook: Boolean(input.hook?.staleCaveat) || staleUsed,
    recipientNamed: Boolean(input.identity?.resolvedName ?? input.prospect.name),
    sellerDocuments: input.sellerDocuments,
    repNotes: input.repNotes !== undefined ? input.repNotes : (input.prospect.notes ?? null),
    hookSignalId: input.kind === "personalised" ? (input.hook?.signalId ?? null) : null,
    prospectNames: prospectNames(input.prospect, input.identity),
  };
}

/** Names the swap test ignores: swapping them for another prospect's is the test. */
export function prospectNames(prospect: ProspectInput, identity: Identity | null): string[] {
  return [identity?.resolvedName, prospect.name, identity?.resolvedCompany, prospect.company, identity?.companyDomain].filter((n): n is string => Boolean(n));
}

export interface GuardInput {
  signals: Signal[];
  sources: Source[];
  staleHook: boolean;
  recipientNamed: boolean;
  sellerDocuments: SellerDocument[];
  repNotes: string | null;
  hookSignalId: string | null;
  prospectNames: string[];
}

/** Deterministic checks plus a model claim audit. A failed claim audit is reported, never silently skipped. */
export async function guardDraft(
  ctx: StageContext,
  draft: { subject: string; body: string; signalIdsUsed: string[] },
  input: GuardInput,
): Promise<GuardReport> {
  const issues = runDeterministicGuard(draft, { ...input, senderWebsite: ctx.sender.companyWebsite });
  const verified = input.signals.filter((s) => s.status === "verified");
  let claims: ClaimCheck[] | null = null;
  let note: string | null = null;
  try {
    ctx.emit("guard", "running", "Auditing every factual claim against its quote");
    const output = await ctx.deps.llm.generate({
      task: "check_claims",
      effort: "low",
      system: CLAIM_SYSTEM,
      user: [
        senderBlock(ctx.sender, fullFocus(ctx.pitch), "full"),
        "",
        sellerMaterialBlock(input.sellerDocuments, draft.body),
        "",
        "VERIFIED FINDINGS (the quote is what counts):",
        verified.length
          ? verified.map((s) => `${s.id} (dated ${s.eventDate ?? input.sources.find((x) => x.id === s.sourceId)?.publishedDate ?? "unknown"}): "${s.evidenceQuote}"`).join("\n")
          : "(none)",
        input.repNotes ? `REP'S OWN NOTES: ${input.repNotes}` : "",
        "",
        `EMAIL SUBJECT: ${draft.subject}`,
        "EMAIL BODY:",
        draft.body,
      ].join("\n"),
      schema: ClaimOutput,
    });
    claims = output.claims;
    issues.push(...claimIssues(claims, input.signals));
  } catch (error) {
    note = `Automated claim check could not run (${error instanceof Error ? error.message : "unknown error"}). Review every factual statement manually.`;
    issues.push({ severity: "warning", code: "claim_check_unavailable", message: note });
  }
  return buildGuardReport(draft.body, issues, claims, note);
}
