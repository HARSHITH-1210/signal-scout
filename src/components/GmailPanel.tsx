"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GmailStatus } from "@/lib/types";
import { send } from "./run/api";
import { Button, buttonClass } from "./ui/Button";
import { useConfirm } from "./ui/Dialog";
import { InfoTip } from "./ui/Tooltip";
import { Icon } from "./Icon";

const SIGN_IN_AGAIN = "/api/auth/signin?consent=1&next=%2Fsettings%23gmail";

/**
 * The Gmail account approved drafts are sent from: the Google account the rep signed in with, so
 * there's no separate connect step. Tokens never reach the browser; only the address and the setting do.
 */
export function GmailPanel({ initial }: { initial: GmailStatus }) {
  const [status, setStatus] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const router = useRouter();

  async function update(body: unknown) {
    setBusy(true);
    setMessage(null);
    const res = await send("/api/gmail", "PUT", body);
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "bad", text: res.error });
    setStatus(res.data as GmailStatus);
  }

  async function revokeAccess() {
    const ok = await confirm({
      title: "Revoke Google access?",
      description: "Signal Scout loses permission to send from this account and you're signed out. Signing in again restores it.",
      confirmLabel: "Revoke and sign out",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const res = await send("/api/gmail", "DELETE");
    if (!res.ok) {
      setBusy(false);
      return setMessage({ tone: "bad", text: res.error });
    }
    router.replace("/signin");
    router.refresh();
  }

  return (
    <section id="gmail" aria-labelledby="gmail-title" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="gmail-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
        <Icon name="mail" className="h-4 w-4 text-fg-muted" />
        Sending account
      </h2>
      {!status.configured ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
          Google sign-in not configured
          <InfoTip label="How to set up Google sign-in" align="start">
            Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local and restart (see the README). Signing in with Google then also sets up sending. Until then, approving only records the review.
          </InfoTip>
        </p>
      ) : !status.connected ? (
        <>
          <p className="mt-2 text-sm text-fg-muted">Approved drafts are sent from the Google account you sign in with.</p>
          <a href="/api/auth/signin?next=%2Fsettings%23gmail" className={buttonClass("primary", "md", "mt-4")}>
            Sign in with Google
          </a>
        </>
      ) : (
        <>
          <p className="mt-3 flex items-center gap-2.5 rounded-lg border border-ok/20 bg-ok-soft px-3 py-2 text-sm text-ok">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
            Sending as <span className="acc truncate text-fg">{status.email}</span>
          </p>
          <p className="mt-2 text-[12px] text-fg-muted">The Gmail of the Google account you signed in with.</p>
          {!status.canSend ? (
            <p className="mt-3 text-sm text-warn">
              Send permission wasn&apos;t granted.{" "}
              <a href={SIGN_IN_AGAIN} className="font-medium underline">
                Sign in again and allow sending
              </a>
            </p>
          ) : (
            !status.canTrack && (
              <p className="mt-3 text-sm text-warn">
                Reply tracking is off.{" "}
                <a href={SIGN_IN_AGAIN} className="font-medium underline">
                  Sign in again to allow it
                </a>
              </p>
            )
          )}
          <div className="mt-4 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <span className="relative inline-flex shrink-0">
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={status.autoSendOnApprove}
                disabled={busy}
                onChange={(e) => update({ autoSendOnApprove: e.target.checked })}
              />
              <span className="h-5 w-9 rounded-full border border-line bg-subtle transition-colors peer-checked:border-transparent peer-checked:bg-[image:var(--t-volt)] peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-45" />
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg shadow-sm transition-transform duration-200 peer-checked:translate-x-4 peer-checked:bg-[var(--t-inv-btn)]" />
            </span>
            <span className="font-medium">Send when I approve</span>
          </label>
          <InfoTip label="About sending on approve" align="start">
            Approve &amp; send emails the exact approved version after a confirmation. Drafts with blocking issues or no recipient are never sent.
          </InfoTip>
          </div>
          <Button variant="ghost" size="sm" className="mt-4 hover:bg-danger-soft hover:text-danger" disabled={busy} onClick={revokeAccess}>
            Revoke Google access
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
