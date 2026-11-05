import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { deleteGmailConnection, getGmailConnection, saveGmailConnection } from "@/lib/db/repo";
import { revoke } from "@/lib/gmail/client";
import { gmailStatus } from "@/lib/gmail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection status for the UI: the connected address and the send-on-approve setting, never tokens. */
export const GET = handle(async () => json(gmailStatus()));

export const PUT = handle(async (request: Request) => {
  const parsed = z.object({ autoSendOnApprove: z.boolean() }).safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Say whether approving should send.");
  const connection = getGmailConnection();
  if (!connection) return badRequest("Connect Gmail first.");
  saveGmailConnection({ ...connection, autoSendOnApprove: parsed.data.autoSendOnApprove });
  return json(gmailStatus());
});

/** Disconnects Gmail: revokes Google access and forgets the tokens. */
export const DELETE = handle(async () => {
  const connection = getGmailConnection();
  if (connection) await revoke(connection);
  deleteGmailConnection();
  return json(gmailStatus());
});
