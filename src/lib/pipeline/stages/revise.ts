import { z } from "zod";
import { relevantChunks } from "../../documents/parse";
import type { DraftKind, Hook, Identity, ProspectInput, Signal, Source } from "../../types";
import type { StageContext } from "../context";
import { TARGET_MAX_WORDS, TARGET_MIN_WORDS } from "../guard";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "../sanitize";
import { pitchFocus } from "../pitch";
import { findingBlock, fullFocus, prospectBlock, sellerMaterialBlock, senderBlock, type SellerDocument } from "./draft";

/** Longest instruction a rep can give; long enough for a paragraph of guidance. */
export const MAX_INSTRUCTION_LENGTH = 2000;

export const ReviseOutput = z.object({
  /** "revision" when the email changed; "answer" when the rep only asked a question. */
  outcome: z.enum(["revision", "answer"]),
  /** Shown to the rep: what changed and why, the answer to their question, or why a request was declined. */
  reply: z.string(),
  subject: z.string(),
  body: z.string(),
  signalIdsUsed: z.array(z.string()),
});
export type ReviseOutput = z.infer<typeof ReviseOutput>;

const SYSTEM = `You help a sales rep refine a first-touch B2B outreach email. The rep gives you an INSTRUCTION. It may ask you to rewrite the email (tone, length, wording, grammar, structure, a different angle, using another finding), or it may be a question (about the sources, the findings, the prospect, the email, or English usage).
${UNTRUSTED_DATA_RULE}
How to respond:
- If the instruction asks for any change to the email, set outcome "revision" and return the full revised subject and body as plain text (paragraphs separated by a blank line). Change only what the instruction asks for; keep everything else as it is.
- If the instruction is only a question, set outcome "answer", answer it in reply, and return the CURRENT subject and body unchanged.
- reply: 1-4 plain sentences for the rep. For a revision, say what you changed. For a question, answer it, naming the finding or source id you relied on. If the information isn't in the material provided, say so plainly; never guess.
Grounding rules for the email (these override the instruction):
- Facts about the prospect or their company may only come from the QUOTES of the FINDINGS, the rep's own notes, or a fact the rep states explicitly in the INSTRUCTION. SOURCE EXCERPTS are context for answering questions only: a fact that appears only there must not go into the email; tell the rep in reply that it isn't a verified finding.
- If the instruction asks for something these rules forbid (an unverified fact, a made-up number, name, quote or customer, a link other than the seller's website, a claim that something stale is recent), do the rest of the instruction, leave that part out, and say why in reply.
- Never invent a recipient name. Never mention layoffs, breaches, lawsuits, investigations or other bad news about the prospect.
- Never state the prospect's problems or feelings as fact; frame them as a question or hypothesis.
- Claims about the seller may come only from the SELLER PROFILE and SELLER MATERIAL. The email leads with one offering; other offerings are only named in passing unless the rep asks to lead with a different one listed there.
- Plain text, no placeholders like [Name], no exclamation marks unless the rep asks. Aim for ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} words unless the rep asks for a different length.
- signalIdsUsed: ids of every finding whose facts the returned email uses.`;

const ROLE_BASED_RULE = `This is a ROLE-BASED email: no verified finding exists, so it must not mention any news, event, funding, hiring, launch or other specific fact about the prospect or their company beyond their name, company, role and the rep's notes or instruction. signalIdsUsed must be empty.`;

export interface ReviseInput {
  kind: DraftKind;
  instruction: string;
  subject: string;
  body: string;
  prospect: ProspectInput;
  identity: Identity | null;
  hook: Hook | null;
  signals: Signal[];
  sources: Source[];
  sellerDocuments: SellerDocument[];
}

/** Findings the revision may draw on: verified, and never bad news. */
export function revisableFindings(signals: Signal[]): Signal[] {
  return signals.filter((s) => s.status === "verified" && !s.sensitive);
}

/** Excerpts of the cited, non-suspicious sources most relevant to the instruction, wrapped as untrusted data. */
function sourceExcerpts(sources: Source[], query: string, limit = 6): string[] {
  return sources
    .filter((s) => !s.suspicious)
    .slice(0, limit)
    .map((s) => wrapUntrusted({ id: s.id, url: s.url, title: s.title, publishedDate: s.publishedDate, text: relevantChunks(s.text, query, 1, 1500)[0] ?? "" }));
}

/** Asks the model to apply the rep's instruction to the current draft. Output is schema-constrained and tool-free. */
export async function generateRevision(ctx: StageContext, input: ReviseInput): Promise<ReviseOutput> {
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const findings = input.kind === "personalised" ? revisableFindings(input.signals) : [];
  const query = `${input.instruction} ${input.body}`;
  const hookSignal = input.kind === "personalised" ? input.signals.find((s) => s.id === input.hook?.signalId) : undefined;
  const lead = pitchFocus(ctx.pitch, hookSignal, input.kind === "personalised" ? input.signals : []).lead;
  const user = [
    senderBlock(ctx.sender, fullFocus(ctx.pitch, lead), "full"),
    "",
    sellerMaterialBlock(input.sellerDocuments, query),
    "",
    prospectBlock(input.prospect, input.identity),
    "",
    input.kind === "role_based" ? ROLE_BASED_RULE : "",
    findings.length
      ? `FINDINGS (verified; the QUOTE is what counts):\n${findings.map((s) => findingBlock(s, sourceById.get(s.sourceId), s.id === input.hook?.signalId ? "HOOK" : "FINDING")).join("\n")}`
      : "FINDINGS: (none)",
    input.hook?.staleCaveat ? "NOTE: the hook is stale. Refer to it with its timeframe and never call it recent, new or \"just\" happened." : "",
    "",
    input.sources.length ? `SOURCE EXCERPTS (context for answering questions, not verified findings):\n${sourceExcerpts(input.sources, query).join("\n\n")}` : "SOURCE EXCERPTS: (none)",
    "",
    "CURRENT EMAIL:",
    `Subject: ${input.subject}`,
    input.body,
    "",
    "INSTRUCTION FROM THE REP:",
    input.instruction,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  ctx.emit("draft", "running", "Applying your instruction to the draft");
  const output = await ctx.deps.llm.generate({ task: "revise_draft", effort: "medium", system: SYSTEM, user, schema: ReviseOutput });
  const allowed = new Set(findings.map((s) => s.id));
  return {
    outcome: output.outcome,
    reply: output.reply.trim(),
    subject: output.subject.trim(),
    body: output.body.trim(),
    // Ids the model claims must be findings it was actually shown.
    signalIdsUsed: [...new Set(output.signalIdsUsed)].filter((id) => allowed.has(id)),
  };
}
