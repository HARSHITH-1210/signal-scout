import { z } from "zod";
import { badRequest, conflict, handle, json, notFound, readJson } from "@/lib/api/http";
import { addDraft, getRun, latestDraft, listSignals, listSources, updateRun, addEvent, getSenderProfile } from "@/lib/db/repo";
import { buildGuardReport, runDeterministicGuard } from "@/lib/pipeline/guard";
import { enqueueRun } from "@/lib/pipeline/runner";
import { logError } from "@/lib/config";
import { GmailError } from "@/lib/gmail/client";
import { checkSendable, sendApprovedDraft } from "@/lib/gmail/send";
import { badNewsHold } from "@/lib/pipeline/sensitive";
import { draftConfidence, isExpired } from "@/lib/pipeline/confidence";
import { prospectNames } from "@/lib/pipeline/stages/draft";
import type { Draft } from "@/lib/types";

/** A draft past its review window must be re-researched, not approved or sent. */
function expiredResponse(draft: Draft) {
  if (!isExpired(draft.notes?.expiresAt)) return null;
  return json({ error: `This draft expired on ${draft.notes!.expiresAt!.slice(0, 10)}: the role or the news may have changed since. Run the research again before sending.`, expired: true }, 409);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EditSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(5000),
  /** The version the editor started from; a newer version means someone else changed the draft. */
  baseVersion: z.number().int().positive(),
});

/** Save a human edit as a new draft version. Deterministic checks re-run; the AI claim audit does not. */
export const PUT = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return notFound();
  const current = latestDraft(id);
  if (!current) return conflict("There is no draft to edit yet.");
  if (run.status !== "awaiting_review" && run.status !== "approved") return conflict("Drafts can only be edited once the run is ready for review.");
  const parsed = EditSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid draft.");
  if (parsed.data.baseVersion !== current.version)
    return json({ error: `This draft changed while you were editing (now version ${current.version}). Your edits weren't saved; review the newer version first.`, latest: current }, 409);

  const signals = listSignals(id);
  const draft = { subject: parsed.data.subject, body: parsed.data.body, signalIdsUsed: current.signalIdsUsed };
  const issues = runDeterministicGuard(draft, {
    signals,
    sources: listSources(id),
    staleHook: Boolean(run.hook?.staleCaveat),
    senderWebsite: getSenderProfile().companyWebsite,
    recipientNamed: Boolean(run.identity?.resolvedName ?? run.prospect.name),
    hookSignalId: current.kind === "personalised" ? (run.hook?.signalId ?? null) : null,
    prospectNames: prospectNames(run.prospect, run.identity),
  });
  const guard = buildGuardReport(draft.body, issues, null, "Edited by a human: the automated claim audit was not re-run. You are responsible for every factual statement.");
  const hookSignal = current.kind === "personalised" ? signals.find((s) => s.id === run.hook?.signalId) : undefined;
  // The expiry stays with the research, not the edit: editing doesn't make old news fresh.
  const notes = current.notes ? { ...current.notes, confidence: draftConfidence(current.kind, hookSignal, run.identity, issues, run.degraded) } : null;
  const saved = addDraft(id, { ...draft, kind: current.kind, author: "human", guard, recipientHint: current.recipientHint, notes });
  // Any edit after approval needs a fresh approval.
  updateRun(id, { status: "awaiting_review", approvedVersion: null });
  addEvent(id, "guard", issues.length ? "warning" : "succeeded", `Rep saved version ${saved.version}`);
  return json({ draft: saved });
});

const ActionSchema = z.object({
  action: z.enum(["regenerate", "role_based", "approve", "send"]),
  /** Required for approve and send: the exact version the reviewer read. */
  version: z.number().int().positive().optional(),
  /** approve only: also send this version through Gmail. */
  send: z.boolean().optional(),
  /** Recipient for sending; defaults to the prospect's email. */
  to: z.string().trim().max(254).optional(),
  /** approve only: the rep has seen the recent bad news about this prospect and still wants to reach out. */
  acknowledgeBadNews: z.boolean().optional(),
  /** approve-and-send / send: the rep checked every fact themselves because the claim audit couldn't run. */
  acknowledgeUnaudited: z.boolean().optional(),
});

/** Sends the approved version; on failure the run stays approved and records why it wasn't sent. */
async function deliver(id: string, version: number, to: string, from: string) {
  try {
    const sent = await sendApprovedDraft(id, version, to, from);
    return json({ status: "sent", sent });
  } catch (error) {
    const message = error instanceof GmailError ? error.message : "Sending failed. See the server log.";
    if (!(error instanceof GmailError)) logError(`send run ${id}`, error);
    updateRun(id, { error: `Approved, but not sent: ${message}` });
    addEvent(id, "guard", "failed", `Approved, but not sent: ${message}`);
    return json({ error: `Approved, but not sent: ${message}`, status: "approved" }, 502);
  }
}

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return notFound();
  const parsed = ActionSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Unknown draft action.");

  switch (parsed.data.action) {
    case "approve": {
      const draft = latestDraft(id);
      if (!draft || run.status !== "awaiting_review") return conflict("Only a draft awaiting review can be approved.");
      if (parsed.data.version === undefined) return badRequest("Say which version you're approving.");
      if (parsed.data.version !== draft.version)
        return json({ error: `A newer version (${draft.version}) exists. Review it before approving.`, latest: draft }, 409);
      const expired = expiredResponse(draft);
      if (expired) return expired;
      if (badNewsHold(listSignals(id)).length > 0 && !parsed.data.acknowledgeBadNews)
        return json({ error: "This prospect is on hold: there's recent bad news about them. Confirm you still want to reach out now.", hold: "bad_news" }, 409);
      // Check everything sending needs BEFORE approving, so a blocked send leaves the draft in review.
      const check = parsed.data.send ? checkSendable(id, draft.version, parsed.data.to, { acknowledgeUnaudited: parsed.data.acknowledgeUnaudited }) : null;
      if (check && !check.ok) return json({ error: check.reason, ...(check.unaudited ? { unaudited: true } : {}) }, 409);
      updateRun(id, { status: "approved", approvedVersion: draft.version });
      if (check?.ok) {
        addEvent(id, "guard", "succeeded", `Rep approved version ${draft.version} and sent it to ${check.to}.`);
        return deliver(id, draft.version, check.to, check.from);
      }
      addEvent(id, "guard", "succeeded", `Rep approved version ${draft.version} without sending.`);
      return json({ status: "approved" });
    }
    case "send": {
      // Retry for an approved draft whose send failed, or approved earlier without sending.
      const draft = latestDraft(id);
      if (!draft || run.status !== "approved" || run.approvedVersion !== draft.version || parsed.data.version !== draft.version)
        return conflict("Only the approved, latest version can be sent.");
      const expired = expiredResponse(draft);
      if (expired) return expired;
      const check = checkSendable(id, draft.version, parsed.data.to, { acknowledgeUnaudited: parsed.data.acknowledgeUnaudited });
      if (!check.ok) return json({ error: check.reason, ...(check.unaudited ? { unaudited: true } : {}) }, 409);
      return deliver(id, draft.version, check.to, check.from);
    }
    case "regenerate": {
      if (!run.hook) return conflict("There is no verified hook to draft from.");
      if (!["awaiting_review", "approved", "failed"].includes(run.status)) return conflict("The run is still in progress.");
      enqueueRun(id, "draft_only");
      return json({ status: "queued" }, 202);
    }
    case "role_based": {
      if (run.status !== "insufficient_research" && !(run.status === "awaiting_review" && latestDraft(id)?.kind === "role_based"))
        return conflict("A role-based draft is only offered when research found no usable hook.");
      enqueueRun(id, "role_based");
      return json({ status: "queued" }, 202);
    }
  }
});
