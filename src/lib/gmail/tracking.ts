import { z } from "zod";
import * as repo from "../db/repo";
import { redact } from "../config";
import type { DeliveryTracking, SentRecord } from "../types";
import { accessToken, canTrack, GmailError, gmailFetch } from "./client";

const THREAD_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
// Bounces usually arrive within a minute or two; until then a send is "pending", not "delivered".
const BOUNCE_GRACE_MS = 10 * 60_000;
// Checking every thread on every page view would burn quota; once per few minutes is plenty.
export const MIN_CHECK_INTERVAL_MS = 5 * 60_000;
const MAX_THREADS_PER_CHECK = 50;

const ThreadSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        internalDate: z.string().optional(),
        payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).optional(),
      }),
    )
    .default([]),
});
export type GmailThread = z.infer<typeof ThreadSchema>;

const header = (m: GmailThread["messages"][number], name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const BOUNCE_SENDER = /\b(mailer-daemon|postmaster)@/i;
const AUTO_SUBJECT = /^(automatic reply|auto(-| )?reply|out of (the )?office|autoreply)\b/i;

/**
 * Classifies a thread after our send, from headers only. A message from a mail daemon (or a delivery
 * report) is a bounce; one marked Auto-Submitted or titled "Automatic reply" is an auto-reply; any other
 * message from someone else is a reply. Exported for tests.
 */
export function classifyThread(thread: GmailThread, sent: Pick<SentRecord, "messageId" | "from" | "sentAt">, now: Date): DeliveryTracking {
  const ours = sent.from.toLowerCase();
  const after = thread.messages.filter((m) => m.id !== sent.messageId);
  const at = (m: GmailThread["messages"][number]) => (m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null);
  const checkedAt = now.toISOString();

  const bounce = after.find((m) => BOUNCE_SENDER.test(header(m, "From")) || /report-type=["']?delivery-status/i.test(header(m, "Content-Type")));
  if (bounce) return { state: "bounced", checkedAt, eventAt: at(bounce) };

  const others = after.filter((m) => !header(m, "From").toLowerCase().includes(ours));
  const isAuto = (m: GmailThread["messages"][number]) => {
    const auto = header(m, "Auto-Submitted").toLowerCase();
    return (auto !== "" && auto !== "no") || header(m, "X-Autoreply") !== "" || AUTO_SUBJECT.test(header(m, "Subject"));
  };
  const human = others.find((m) => !isAuto(m));
  if (human) return { state: "replied", checkedAt, eventAt: at(human) };
  const auto = others.find(isAuto);
  if (auto) return { state: "auto_reply", checkedAt, eventAt: at(auto) };

  const age = now.getTime() - new Date(sent.sentAt).getTime();
  return { state: age < BOUNCE_GRACE_MS ? "pending" : "delivered", checkedAt, eventAt: null };
}

async function fetchThread(token: string, threadId: string): Promise<GmailThread> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "Subject", "Auto-Submitted", "X-Autoreply", "Content-Type"]) params.append("metadataHeaders", h);
  const res = await gmailFetch(`${THREAD_URL}/${encodeURIComponent(threadId)}?${params}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }).catch(
    (e: unknown) => {
      throw new GmailError(`Couldn't reach Gmail (${redact(e instanceof Error ? e.message : String(e))}).`, "unavailable");
    },
  );
  if (res.status === 401 || res.status === 403) throw new GmailError("Gmail refused the check. Sign out and sign in again.", "auth");
  if (res.status === 404) return { messages: [] };
  if (!res.ok) throw new GmailError(`Gmail couldn't return the thread (HTTP ${res.status}).`, "unavailable");
  const parsed = ThreadSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new GmailError("Gmail returned an unexpected thread format.", "unavailable");
  return parsed.data;
}

export type TrackingResult = { checked: number; skipped: "throttled" | "not_connected" | "no_permission" | null; error: string | null };

/**
 * Re-checks the signed-in rep's (`account`) sent emails for replies and bounces. Final states (replied, bounced) aren't re-checked.
 * Throttled unless forced; never throws (errors come back as a message for the page).
 */
export async function refreshTracking(account: string | null, options: { force?: boolean; now?: Date } = {}): Promise<TrackingResult> {
  const now = options.now ?? new Date();
  const connection = repo.getGmailConnection(account);
  if (!connection) return { checked: 0, skipped: "not_connected", error: null };
  if (!canTrack(connection)) return { checked: 0, skipped: "no_permission", error: null };

  const due = repo
    .listSentRuns()
    .filter(({ sent }) => sent.threadId && sent.from.toLowerCase() === connection.email.toLowerCase())
    .filter(({ sent }) => sent.tracking?.state !== "replied" && sent.tracking?.state !== "bounced")
    .filter(({ sent }) => options.force || !sent.tracking || now.getTime() - new Date(sent.tracking.checkedAt).getTime() >= MIN_CHECK_INTERVAL_MS)
    .slice(0, MAX_THREADS_PER_CHECK);
  if (due.length === 0) return { checked: 0, skipped: options.force ? null : "throttled", error: null };

  let checked = 0;
  try {
    const token = await accessToken(connection);
    for (const { runId, sent } of due) {
      const thread = await fetchThread(token, sent.threadId!);
      repo.updateRun(runId, { sent: { ...sent, tracking: classifyThread(thread, sent, now) } });
      checked++;
    }
    return { checked, skipped: null, error: null };
  } catch (error) {
    return { checked, skipped: null, error: error instanceof GmailError ? error.message : "Checking replies failed." };
  }
}
