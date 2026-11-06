"use client";

import { useState } from "react";
import type { GmailStatus } from "@/lib/types";
import { Icon } from "./Icon";
import { send } from "./run/api";

const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-obsidian px-4 text-sm font-bold text-obsidian transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-45";

/** Gmail connection for sending approved drafts. Tokens never reach the browser; only the address and the setting do. */
export function GmailPanel({ initial, result }: { initial: GmailStatus; result: { tone: "ok" | "bad"; text: string } | null }) {
  const [status, setStatus] = useState(initial);
  const [message, setMessage] = useState(result);
  const [busy, setBusy] = useState(false);

  async function update(method: "PUT" | "DELETE", body?: unknown, success?: string) {
    setBusy(true);
    setMessage(null);
    const res = await send("/api/gmail", method, body);
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "bad", text: res.error });
    setStatus(res.data as GmailStatus);
    if (success) setMessage({ tone: "ok", text: success });
  }

  return (
    <section id="gmail" aria-labelledby="gmail-title" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="gmail-title" className="text-[15px] font-bold">
        Send with Gmail
      </h2>
      {!status.configured ? (
        <p className="mt-1 text-sm text-fg-soft">
          Not set up. Add <span className="acc">GOOGLE_CLIENT_ID</span> and <span className="acc">GOOGLE_CLIENT_SECRET</span> to <span className="acc">.env.local</span> and restart. The
          README explains how to create them. Until then, approving only records the review.
        </p>
      ) : !status.connected ? (
        <>
          <p className="mt-1 text-sm text-fg-soft">Connect a Gmail account to send an approved draft from the run page. Signal Scout asks to send, and to read message headers (sender, time) of threads it sent, to track replies and bounces. It never reads email bodies.</p>
          <a href="/api/gmail/connect" className={`${secondary} mt-4`}>
            Connect Gmail
          </a>
        </>
      ) : (
        <>
          <p className="mt-1 flex items-center gap-2 text-sm text-ok">
            <Icon name="check" />
            Connected as <span className="acc text-fg">{status.email}</span>
          </p>
          {!status.canTrack && (
            <p className="mt-3 text-sm text-warn">
              Reply and bounce tracking is off for this connection.{" "}
              <a href="/api/gmail/connect" className="font-bold underline">
                Reconnect Gmail
              </a>{" "}
              to allow header-only access.
            </p>
          )}
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={status.autoSendOnApprove}
              disabled={busy}
              onChange={(e) => update("PUT", { autoSendOnApprove: e.target.checked })}
            />
            <span>
              <span className="font-bold">Send when I approve</span>
              <span className="block text-[13px] text-fg-muted">
                Approve &amp; send emails the exact approved version after a confirmation. Drafts with blocking issues, or without a recipient address, are never sent.
              </span>
            </span>
          </label>
          <button type="button" onClick={() => update("DELETE", undefined, "Disconnected. Google access was revoked.")} disabled={busy} className="mt-4 min-h-11 text-sm font-bold text-fg-soft hover:text-danger disabled:opacity-45">
            Disconnect Gmail
          </button>
        </>
      )}
      {message && (
        <p role="status" className={`mt-3 text-sm ${message.tone === "bad" ? "text-danger" : "text-ok"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
