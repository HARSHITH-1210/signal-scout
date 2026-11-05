import { z } from "zod";
import { SIGNAL_TYPES, type Identity, type ProspectInput, type RunPitch, type SenderProfile, type Signal, type SignalType, type Source } from "../../types";
import type { StageContext } from "../context";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "../sanitize";

const ExtractionOutput = z.object({
  signals: z.array(
    z.object({
      type: z.enum(SIGNAL_TYPES),
      about: z.enum(["person", "company"]),
      claim: z.string(),
      evidenceQuote: z.string(),
      sourceId: z.string(),
      eventDate: z.string().nullable(),
      relevance: z.number(),
      whyItMatters: z.string(),
      offerLink: z.string().nullable(),
      offeringId: z.string().nullable(),
    }),
  ),
});

const SYSTEM = `You are a meticulous B2B sales researcher. From the provided sources, extract concrete, recent-looking business signals about ONE prospect and their company that a seller could reference in a first-touch email.
${UNTRUSTED_DATA_RULE}

Rules:
- Only extract signals about the specified person and company. Ignore namesakes, competitors, and generic industry content.
- Each signal must cite exactly one sourceId and include evidenceQuote: an exact, contiguous, verbatim excerpt (15-300 characters) copied from that source's text that directly supports the claim. Do not paraphrase, fix typos, or stitch sentences together. Signals whose quote is not verbatim will be discarded automatically.
- claim: one neutral sentence stating only what the quote supports. No embellishment, no numbers that aren't in the quote.
- eventDate: when the event happened if the source states it (YYYY-MM-DD, YYYY-MM or YYYY), else null. Do not infer dates from today's date.
- type: pick the most specific type. A funding round is "funding", a launch is "product_launch", a market entry is "expansion"; use "other" only for generic background (founding year, HQ, boilerplate product descriptions or marketing statistics).
- relevance (0.0-1.0): how useful this is as an opening hook for THIS prospect, given their role and the seller's offerings. Specific, role-relevant, actionable signals score high; generic company facts (founding year, HQ, boilerplate "about us") score below 0.3.
- whyItMatters: one sentence, clearly an inference, linking the signal to the prospect's likely priorities and the seller's offering.
- offerLink: one short sentence naming the specific problem this signal suggests that one of the seller's offerings solves (signal → problem → offer). Use null when the signal is interesting but has no clear connection to any offering. Be strict: a real but unrelated signal gets null.
- offeringId: the id of the SELLER OFFERING that offerLink refers to (the single best fit), or null when offerLink is null or no offerings are listed.
- Sources whose domain is "your document" are files the sales rep uploaded about this prospect (an account brief, CRM row or notes). They are trustworthy descriptions of the prospect: extract signals from them like any other source, quoting them verbatim.
- Prefer quality over quantity: return at most 10 signals, and return an empty list if nothing qualifies. Never invent signals.`;

/** The pitched offerings as the extractor sees them, with the ids it must link findings to. */
export function offeringsBlock(pitch: RunPitch): string {
  if (pitch.offerings.length === 0) return "SELLER OFFERINGS: (not set: judge relevance by general business significance for this role)";
  return [
    "SELLER OFFERINGS (link each finding to the single best fit by id):",
    ...pitch.offerings.map((o) => `  [${o.id}] ${o.name} (${o.sectorName}): ${o.whatItDoes || "(no description)"}`),
  ].join("\n");
}

export function buildExtractionPrompt(prospect: ProspectInput, identity: Identity, sender: SenderProfile, pitch: RunPitch, sources: Source[], today: string): string {
  return [
    `TODAY: ${today}`,
    `PROSPECT: ${identity.resolvedName ?? prospect.name ?? "(no specific person: research is about the company; only extract company signals)"}`,
    `ROLE: ${identity.resolvedRole ?? prospect.role ?? "unknown"}${identity.personConfirmed ? "" : " (rep-provided; person not confirmed in public sources)"}`,
    `COMPANY: ${identity.resolvedCompany ?? prospect.company ?? "unknown"}${identity.companyDomain ? ` (${identity.companyDomain})` : ""}`,
    identity.companyDescription ? `COMPANY DESCRIPTION: ${identity.companyDescription}` : "",
    "",
    `SELLER: ${sender.companyName || "(not set)"}`,
    offeringsBlock(pitch),
    "",
    "SOURCES:",
    sources.map(wrapUntrusted).join("\n\n"),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

const TYPE_HINTS: [SignalType, RegExp][] = [
  ["funding", /\b(raised|raises|funding|series [a-h]\b|valuation|investment round|seed round|ipo|acquired|acquisition)\b/i],
  ["hiring", /\b(hiring|is recruiting|job (opening|posting)|open roles?|headcount)\b/i],
  ["leadership_change", /\b(appointed|named (as )?(its )?(new )?(ceo|cfo|cto|coo|chief|vp|head)|joins? as|promoted to|stepped down)\b/i],
  ["partnership", /\b(partnership|partnered|strategic collaboration|teamed up|alliance)\b/i],
  ["expansion", /\b(expan(d|ds|ded|sion)|launch(es|ed)? in|enter(s|ed)? (the )?[A-Z]?\w+ market|new office|opened .* office)\b/i],
  ["product_launch", /\b(launch(es|ed)?|introduc(es|ed)|unveil(s|ed)|released|rolled out|announced .* (product|feature|platform))\b/i],
  ["interview_or_talk", /\b(podcast|interview|keynote|said|told|discussed|argued|wrote)\b/i],
  ["strategic_priority", /\b(strategy|priority|priorities|focus(ing)? on|plans? to)\b/i],
];

/**
 * Weaker models label most findings "other". Infer the real type from the claim's wording so a
 * funding round or launch isn't treated (and capped) as a generic fact.
 */
export function inferSignalType(type: SignalType, claim: string): SignalType {
  if (type !== "other") return type;
  return TYPE_HINTS.find(([, pattern]) => pattern.test(claim))?.[0] ?? "other";
}

/** Relevance ceiling for a signal with no link to the offer: below HOOK_THRESHOLD even with perfect freshness and reliability. */
export const UNLINKED_RELEVANCE_CAP = 0.3;

/** Claude proposes candidate signals. Nothing here is trusted until the verify stage checks it. */
export async function extractSignals(
  ctx: StageContext,
  prospect: ProspectInput,
  identity: Identity,
  sources: Source[],
): Promise<Signal[]> {
  if (sources.length === 0) return [];
  ctx.emit("extract_signals", "running", `Reading ${sources.length} source(s) for signals`);
  const output = await ctx.deps.llm.generate({
    task: "extract_signals",
    effort: "medium",
    system: SYSTEM,
    user: buildExtractionPrompt(prospect, identity, ctx.sender, ctx.pitch, sources, ctx.deps.now().toISOString().slice(0, 10)),
    schema: ExtractionOutput,
  });
  return output.signals.slice(0, 12).map((s, i) => {
    const type = inferSignalType(s.type, s.claim);
    const pitched = ctx.pitch.offerings;
    const offerLink = s.offerLink?.trim() || null;
    const noOfferLink = pitched.length > 0 && !offerLink;
    // Only an offering that was actually pitched can be linked; with one offering there's nothing to choose.
    const offeringId = !offerLink ? null : pitched.some((o) => o.id === s.offeringId) ? s.offeringId : pitched.length === 1 ? pitched[0].id : null;
    return {
    id: `G${i + 1}`,
    type,
    about: s.about,
    claim: s.claim.trim(),
    evidenceQuote: s.evidenceQuote.trim(),
    sourceId: s.sourceId.trim(),
    eventDate: s.eventDate,
    // Generic "other" facts rarely make a good hook; and a signal with no link to the offer can't be one,
    // however interesting (capped below the hook threshold). Without a seller offering there's nothing to link to.
    relevance: Number.isFinite(s.relevance) ? Math.min(type === "other" ? 0.5 : 1, noOfferLink ? UNLINKED_RELEVANCE_CAP : 1, Math.max(0, s.relevance)) : 0,
    whyItMatters: s.whyItMatters.trim(),
    offerLink,
    offeringId,
    status: "verified",
    statusReason: null,
    freshness: "unknown",
    ageDays: null,
    reliability: 0,
    corroboratingSourceIds: [],
    conflictGroup: null,
    score: null,
  } satisfies Signal;
  });
}
