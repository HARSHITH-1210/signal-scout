import * as repo from "../db/repo";
import type { GmailStatus, SentRecord } from "../types";
import { GmailError, gmailConfigured, sendRaw } from "./client";
import { buildRawMessage, isSafeAddress } from "./mime";
import { isExpired } from "../pipeline/confidence";
import { checkContactRules } from "../pipeline/contacts";

export function gmailStatus(): GmailStatus {
  const connection = repo.getGmailConnection();
  return {
    configured: gmailConfigured(),
    connected: Boolean(connection),
    email: connection?.email ?? null,
    autoSendOnApprove: connection?.autoSendOnApprove ?? false,
  };
}

// Runs with a send in flight. Checked and set without an await in between, so two tabs can't both send.
const inFlight = new Set<string>();

export type SendCheck = { ok: true; to: string; from: string } | { ok: false; reason: string };

/**
 * Everything that must be true before an approval may send an email. Checked BEFORE approving, so a
 * failed check leaves the draft in review rather than approved-but-unsent.
 */
export function checkSendable(runId: string, version: number, to: string | undefined): SendCheck {
  if (!gmailConfigured()) return { ok: false, reason: "Gmail isn't set up (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." };
  const connection = repo.getGmailConnection();
  if (!connection) return { ok: false, reason: "Connect Gmail in Sender profile first." };
  const run = repo.getRun(runId);
  if (!run) return { ok: false, reason: "Run not found." };
  if (inFlight.has(runId)) return { ok: false, reason: "This draft is being sent right now." };
  if (run.sent && run.sent.version === version) return { ok: false, reason: `Version ${version} was already sent to ${run.sent.to}.` };
  const recipient = (to ?? run.prospect.email ?? "").trim();
  if (!recipient) return { ok: false, reason: "Add the recipient's email address before sending." };
  if (!isSafeAddress(recipient)) return { ok: false, reason: "The recipient's email address isn't valid." };
  const optOut = checkContactRules({ email: recipient }, repo.getContactRules(), true);
  if (optOut) return { ok: false, reason: `${recipient} is on your do-not-contact list (${optOut.match}).` };
  const draft = repo.latestDraft(runId);
  if (!draft || draft.version !== version) return { ok: false, reason: "A newer version exists. Review it before sending." };
  if (isExpired(draft.notes?.expiresAt)) return { ok: false, reason: "This draft has expired. Run the research again before sending." };
  const blocking = draft.guard.issues.filter((i) => i.severity === "error");
  if (blocking.length > 0)
    return { ok: false, reason: `Fix ${blocking.length === 1 ? "the issue" : `the ${blocking.length} issues`} flagged in Checks before sending (${blocking[0].message})` };
  return { ok: true, to: recipient, from: connection.email };
}

/** Sends the approved version through Gmail and records the result. Never retried automatically. */
export async function sendApprovedDraft(runId: string, version: number, to: string, from: string): Promise<SentRecord> {
  const connection = repo.getGmailConnection();
  const draft = repo.latestDraft(runId);
  if (!connection || !draft || draft.version !== version) throw new GmailError("The draft or the Gmail connection changed. Reload and try again.", "rejected");
  if (inFlight.has(runId)) throw new GmailError("This draft is being sent right now.", "rejected");
  inFlight.add(runId);
  let messageId: string;
  try {
    messageId = await sendRaw(connection, buildRawMessage({ from, to, subject: draft.subject, body: draft.body }));
  } finally {
    inFlight.delete(runId);
  }
  const record: SentRecord = { to, from, version, messageId, sentAt: new Date().toISOString() };
  repo.updateRun(runId, { status: "sent", sent: record, error: null });
  repo.addEvent(runId, "guard", "succeeded", `Sent version ${version} to ${to} from ${from} via Gmail (message ${messageId}).`);
  return record;
}
