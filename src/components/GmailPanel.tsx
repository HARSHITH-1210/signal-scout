"use client";

import { useState } from "react";
import type { GmailStatus } from "@/lib/types";
import { send } from "./run/api";
import { Button, buttonClass } from "./ui/Button";
import { useConfirm } from "./ui/Dialog";
import { Icon } from "./Icon";

/** Gmail connection for sending approved drafts. Tokens never reach the browser; only the address and the setting do. */
export function GmailPanel({ initial, result }: { initial: GmailStatus; result: { tone: "ok" | "bad"; text: string } | null }) {
  const [status, setStatus] = useState(initial);
  const [message, setMessage] = useState(result);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function update(method: "PUT" | "DELETE", body?: unknown, success?: string) {
    setBusy(true);
    setMessage(null);
    const res = await send("/api/gmail", method, body);
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "bad", text: res.error });
    setStatus(res.data as GmailStatus);
    if (success) setMessage({ tone: "ok", text: success });
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Gmail?",
      description: "Google access is revoked. Approved drafts can't be sent from here until you connect again.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (ok) void update("DELETE", undefined, "Disconnected. Google access was revoked.");
  }

  return (
    <section id="gmail" aria-labelledby="gmail-title" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="gmail-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
        <Icon name="mail" className="h-4 w-4 text-fg-muted" />
        Send with Gmail
      </h2>
      {!status.configured ? (
        <p className="mt-2 text-sm text-fg-muted">
          Not set up. Add <span className="acc">GOOGLE_CLIENT_ID</span> and <span className="acc">GOOGLE_CLIENT_SECRET</span> to <span className="acc">.env.local</span> and restart. The
          README explains how to create them. Until then, approving only records the review.
        </p>
      ) : !status.connected ? (
        <>
          <p className="mt-2 text-sm text-fg-muted">
            Connect a Gmail account to send an approved draft from the run page. Signal Scout asks to send, and to read message headers (sender, time) of threads it sent, to track replies and
            bounces. It never reads email bodies.
          </p>
          <a href="/api/gmail/connect" className={buttonClass("primary", "md", "mt-4")}>
            Connect Gmail
          </a>
        </>
      ) : (
        <>
          <p className="mt-3 flex items-center gap-2.5 rounded-lg border border-ok/20 bg-ok-soft px-3 py-2 text-sm text-ok">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
            Connected as <span className="acc truncate text-fg">{status.email}</span>
          </p>
          {!status.canTrack && (
            <p className="mt-3 text-sm text-warn">
              Reply and bounce tracking is off for this connection.{" "}
              <a href="/api/gmail/connect" className="font-medium underline">
                Reconnect Gmail
              </a>{" "}
              to allow header-only access.
            </p>
          )}
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
            <span className="relative mt-0.5 inline-flex shrink-0">
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={status.autoSendOnApprove}
                disabled={busy}
                onChange={(e) => update("PUT", { autoSendOnApprove: e.target.checked })}
              />
              <span className="h-5 w-9 rounded-full border border-line bg-subtle transition-colors peer-checked:border-transparent peer-checked:bg-obsidian peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-45" />
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-200 peer-checked:translate-x-4" />
            </span>
            <span>
              <span className="font-medium">Send when I approve</span>
              <span className="block text-[13px] text-fg-muted">
                Approve &amp; send emails the exact approved version after a confirmation. Drafts with blocking issues, or without a recipient address, are never sent.
              </span>
            </span>
          </label>
          <Button variant="ghost" size="sm" className="mt-4 hover:bg-danger-soft hover:text-danger" disabled={busy} onClick={disconnect}>
            Disconnect Gmail
          </Button>
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
