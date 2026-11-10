import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { deleteGmailConnection, getGmailConnection, saveGmailConnection } from "@/lib/db/repo";
import { revoke } from "@/lib/gmail/client";
import { gmailStatus } from "@/lib/gmail/send";
import { clearSession, requestUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection status for the UI: the connected address and the send-on-approve setting, never tokens. */
export const GET = handle(async (request: Request) => json(gmailStatus(await requestUser(request))));

export const PUT = handle(async (request: Request) => {
  const parsed = z.object({ autoSendOnApprove: z.boolean() }).safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Say whether approving should send.");
  const email = await requestUser(request);
  const connection = getGmailConnection(email);
  if (!connection) return badRequest("Sign in with Google first.");
  saveGmailConnection({ ...connection, autoSendOnApprove: parsed.data.autoSendOnApprove });
  return json(gmailStatus(email));
});

/** Revokes Google access, forgets the tokens and signs out: sign-in and sending are one Google grant. */
export const DELETE = handle(async (request: Request) => {
  const email = await requestUser(request);
  const connection = getGmailConnection(email);
  if (connection) await revoke(connection);
  if (email) deleteGmailConnection(email);
  const res = json(gmailStatus(null));
  clearSession(res);
  return res;
});
