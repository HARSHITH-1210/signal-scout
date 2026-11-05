"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { Draft, GmailStatus, RunDetail } from "@/lib/types";
import { formatDateTime } from "@/lib/ui/format";
import { Badge } from "../Badge";
import { Icon } from "../Icon";
import { send } from "./api";

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45";

/** Keyed by draft id in RunView, so a new version remounts the editor with fresh state. */
export function DraftEditor({ detail, gmail, onChanged, onResumed }: { detail: RunDetail; gmail: GmailStatus; onChanged: () => void; onResumed: () => void }) {
  const draft = detail.drafts[detail.drafts.length - 1] as Draft | undefined;
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [to, setTo] = useState(detail.sent?.to ?? detail.prospect.email ?? "");
  const titleId = useId();

  if (!draft) return null;
  const dirty = subject !== draft.subject || body !== draft.body;
  const errors = draft.guard.issues.filter((i) => i.severity === "error");
  const warnings = draft.guard.issues.filter((i) => i.severity === "warning");
  const approved = detail.status === "approved" && detail.approvedVersion === draft.version;
  const sent = detail.status === "sent" ? detail.sent : null;
  const confidence = draft.notes?.confidence;
  const expiresAt = draft.notes?.expiresAt;
  // A draft that crosses its expiry while open is caught by the server on approve.
  const expired = !sent && Boolean(expiresAt) && new Date(expiresAt!).getTime() < openedAt;
  // Mirrors badNewsHold on the server: recent bad news holds the draft until the rep confirms.
  const badNews = detail.signals.filter((s) => s.status === "verified" && s.sensitive && s.freshness !== "stale");
  const onHold = (badNews.length > 0 && !acknowledged && !approved && !sent) || expired;
  const autoSend = gmail.connected && gmail.autoSendOnApprove;
  const toValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const words = wordCount(body);
  const noName = !(detail.identity?.resolvedName ?? detail.prospect.name);

  async function act(label: string, run: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, success: string, after?: () => void) {
    setBusy(label);
    setMessage(null);
    const result = await run();
    setBusy(null);
    if (result.ok) {
      setMessage({ tone: "ok", text: success });
      after?.();
    } else {
      setMessage({ tone: "bad", text: result.error ?? "Something went wrong." });
      // Another tab moved the draft on, or the approval went through but the send didn't: reload either way.
      const data = result.data as { latest?: unknown; status?: string } | undefined;
      if (data?.latest || data?.status) onChanged();
    }
  }

  const save = () =>
    act("save", () => send(`/api/runs/${detail.id}/draft`, "PUT", { subject, body, baseVersion: draft.version }), "Saved as a new version. Length, tone and link checks ran on your edit.", onChanged);
  const approve = () =>
    act("approve", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "approve", version: draft.version, acknowledgeBadNews: acknowledged }), `Version ${draft.version} approved. Nothing was sent.`, onChanged);
  /** Sending can't be undone, so the rep confirms the exact recipient and sender first. */
  const confirmSend = () =>
    window.confirm(`Send version ${draft.version} to ${to.trim()} from ${gmail.email}?\n\nSubject: ${draft.subject}\n\nThis sends a real email through Gmail and can't be undone.`);
  const approveAndSend = () => {
    if (!confirmSend()) return;
    act("approve", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "approve", version: draft.version, send: true, to: to.trim(), acknowledgeBadNews: acknowledged }), `Approved and sent to ${to.trim()}.`, onChanged);
  };
  const sendNow = () => {
    if (!confirmSend()) return;
    act("send", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "send", version: draft.version, to: to.trim() }), `Sent to ${to.trim()}.`, onChanged);
  };
  async function researchAgain() {
    setBusy("rerun");
    setMessage(null);
    const result = await send("/api/runs", "POST", {
      ...detail.prospect,
      documents: detail.documents.map((d) => ({ documentId: d.documentId, rowIndex: d.rowIndex })),
      force: true,
    });
    setBusy(null);
    if (!result.ok) return setMessage({ tone: "bad", text: result.error });
    router.push(`/runs/${(result.data as { id: string }).id}`);
  }
  const regenerate = () =>
    act("regenerate", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: draft.kind === "role_based" ? "role_based" : "regenerate" }), "Writing a new version from the same research.", onResumed);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage({ tone: "bad", text: "Your browser blocked clipboard access. Select the text and copy it manually." });
    }
  }

  return (
    <section aria-labelledby={titleId} className="rounded-[var(--radius-panel)] border border-rule bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="text-[15px] font-bold">
            Draft
          </h2>
          {draft.kind === "role_based" ? <Badge tone="warn">Role-based</Badge> : <Badge tone="info">Personalised</Badge>}
          {approved && <Badge tone="ok">Approved</Badge>}
          {sent && <Badge tone="ok">Sent</Badge>}
          {confidence && (
            <Badge tone={confidence.level === "high" ? "ok" : confidence.level === "medium" ? "info" : "warn"}>
              {confidence.level === "high" ? "High" : confidence.level === "medium" ? "Medium" : "Low"} confidence
            </Badge>
          )}
        </div>
        <span className="acc text-muted">
          v{draft.version} by {draft.author === "ai" ? "Signal Scout" : "you"}, {formatDateTime(draft.createdAt)}
          {expiresAt && !sent && !expired ? `, use by ${formatDateTime(expiresAt).split(",")[0]}` : ""}
        </span>
      </div>

      {draft.kind === "role_based" && (
        <p className="border-b border-rule bg-ochre-soft px-5 py-2.5 text-sm text-ochre">No verified hook was found, so this draft deliberately makes no claims about the prospect or their company.</p>
      )}
      {noName && (
        <p className="border-b border-rule bg-det-soft px-5 py-2.5 text-sm text-det">
          No person was named, so it opens with “Hi there”.{" "}
          {draft.recipientHint ? (
            <>
              Send it to the <strong>{draft.recipientHint}</strong>
              {detail.identity?.resolvedCompany ? ` at ${detail.identity.resolvedCompany}` : ""}.
            </>
          ) : (
            "Choose who to send it to."
          )}
        </p>
      )}

      {confidence && confidence.reasons.length > 0 && (
        <div className="border-b border-rule px-5 py-2.5 text-[13px] text-ink-soft">
          <span className="font-bold">Based on {confidence.basis === "person" ? "the person" : confidence.basis === "company" ? "their company" : "their role only"}.</span>{" "}
          {confidence.reasons.join(" ")}
        </div>
      )}

      {expired && (
        <div className="border-b border-rule bg-ochre-soft px-5 py-3 text-sm text-ochre">
          <p className="font-bold">Expired on {formatDateTime(expiresAt!)}</p>
          <p className="mt-0.5">The role may be filled or the news may have changed since this was researched. Research again before sending.</p>
          <button onClick={researchAgain} disabled={busy !== null} className={`${btn} mt-2 border border-rail bg-paper text-rail hover:bg-board`}>
            {busy === "rerun" ? "Starting…" : "Research again"}
          </button>
        </div>
      )}

      {badNews.length > 0 && !sent && (
        <div className="border-b border-rule bg-ochre-soft px-5 py-3 text-sm text-ochre">
          <p className="font-bold">On hold: recent bad news</p>
          <ul className="mt-1 space-y-0.5">
            {badNews.slice(0, 3).map((s) => (
              <li key={s.id}>{s.claim}</li>
            ))}
          </ul>
          <p className="mt-1">It isn&apos;t used in the draft. Outreach right now may land badly.</p>
          {!approved && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 font-bold">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              I&apos;ve read this and still want to reach out now
            </label>
          )}
        </div>
      )}

      {sent && (
        <div className="border-b border-rule bg-ok-soft px-5 py-3 text-sm text-ok">
          <p className="flex items-center gap-2 font-bold">
            <Icon name="check" />
            Sent version {sent.version} to {sent.to}
          </p>
          <p className="acc mt-1 text-[12px]">
            from {sent.from}, {formatDateTime(sent.sentAt)}, Gmail id {sent.messageId}
          </p>
        </div>
      )}

      <div className="px-5 pt-4 pb-5">
        {gmail.connected && !sent && (
          <label className="mb-4 block text-sm">
            <span className="font-bold">To</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@company.com"
              aria-describedby={`${titleId}-to`}
              className="mt-1.5 w-full rounded-lg border border-rule bg-white px-3 py-2.5 focus:border-det focus:outline-none focus:ring-2 focus:ring-det/30"
            />
            <span id={`${titleId}-to`} className="mt-1 block text-[13px] text-muted">
              {!to.trim() ? (
                <span className="text-ochre">Add the recipient&apos;s address to send. </span>
              ) : !toValid ? (
                <span className="text-specimen">This isn&apos;t a valid address. </span>
              ) : null}
              Sends from {gmail.email}.
            </span>
          </label>
        )}
        <label className="block text-sm">
          <span className="font-bold">Subject</span>
          <input
            readOnly={Boolean(sent)}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-rule bg-white px-3 py-2.5 font-bold focus:border-det focus:outline-none focus:ring-2 focus:ring-det/30"
          />
        </label>
        {!sent && (draft.notes?.alternateSubjects.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-muted">Try:</span>
            {draft.notes!.alternateSubjects.map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => setSubject(alt)}
                className="min-h-8 rounded-full border border-rule px-2.5 text-ink-soft hover:border-det hover:text-det"
              >
                {alt}
              </button>
            ))}
          </div>
        )}
        <label className="mt-4 block text-sm">
          <span className="flex items-baseline justify-between">
            <span className="font-bold">Message</span>
            <span className={`acc ${words > 200 || words < 90 ? "text-ochre" : "text-muted"}`}>{words} words</span>
          </span>
          <textarea
            readOnly={Boolean(sent)}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(24, Math.max(14, body.split("\n").length + 4))}
            className="mt-1.5 w-full rounded-lg border border-rule bg-white px-4 py-3 text-[16px] leading-[1.65] focus:border-det focus:outline-none focus:ring-2 focus:ring-det/30"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!sent && !approved && autoSend && (
            <>
              <button
                onClick={approveAndSend}
                disabled={dirty || !toValid || onHold || busy !== null}
                title={dirty ? "Save your edits before approving" : !toValid ? "Add the recipient's email address" : undefined}
                className={`${btn} bg-action text-white hover:bg-action-strong`}
              >
                <Icon name="check" />
                {busy === "approve" ? "Sending…" : "Approve & send"}
              </button>
              <button onClick={approve} disabled={dirty || onHold || busy !== null} className={`${btn} border border-rail text-rail hover:bg-board`}>
                Approve only
              </button>
            </>
          )}
          {!sent && !approved && !autoSend && (
            <button onClick={approve} disabled={dirty || onHold || busy !== null} title={dirty ? "Save your edits before approving" : undefined} className={`${btn} bg-action text-white hover:bg-action-strong`}>
              <Icon name="check" />
              {busy === "approve" ? "Approving…" : `Approve v${draft.version}`}
            </button>
          )}
          {approved && gmail.connected && (
            <button onClick={sendNow} disabled={dirty || !toValid || expired || busy !== null} title={dirty ? "Save and re-approve your edits before sending" : undefined} className={`${btn} bg-action text-white hover:bg-action-strong`}>
              {busy === "send" ? "Sending…" : "Send now"}
            </button>
          )}
          {!sent && (
            <button onClick={save} disabled={!dirty || busy !== null} className={`${btn} border border-rail text-rail hover:bg-board`}>
              {busy === "save" ? "Saving…" : "Save edits"}
            </button>
          )}
          <button onClick={copy} className={`${btn} border border-rule text-ink-soft hover:bg-board`}>
            <Icon name={copied ? "check" : "copy"} />
            {copied ? "Copied" : "Copy"}
          </button>
          {!sent && (
            <button onClick={regenerate} disabled={busy !== null} className={`${btn} ml-auto px-2 text-det hover:underline`}>
              <Icon name="refresh" />
              New version
            </button>
          )}
        </div>
        <p role="status" className={`mt-2 min-h-5 text-sm ${message?.tone === "bad" ? "text-specimen" : "text-ok"}`}>
          {message?.text}
        </p>
        {detail.error && (detail.status === "awaiting_review" || detail.status === "approved") && <p className="text-sm text-specimen">{detail.error}</p>}
        <p className="mt-1 text-[13px] text-muted">
          {sent
            ? "This version was sent and can no longer be edited."
            : autoSend
              ? "Approve & send emails this exact version after you confirm. Approve only records the review and sends nothing."
              : gmail.connected
                ? "Approving records that a person reviewed this exact version. Send it afterwards with Send now."
                : (
                    <>
                      Approving records that a person reviewed this exact version. Nothing is sent.{" "}
                      {gmail.configured && (
                        <Link href="/settings#gmail" className="font-bold text-det hover:underline">
                          Connect Gmail to send from here
                        </Link>
                      )}
                    </>
                  )}
        </p>
      </div>

      {(draft.notes?.rationale.length ?? 0) > 0 && (
        <div className="border-t border-rule px-5 py-4">
          <h3 className="text-sm font-bold">Why this draft</h3>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
            {draft.notes!.rationale.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rail" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-rule px-5 py-4">
        <h3 className="text-sm font-bold">Checks on v{draft.version}</h3>
        {draft.guard.issues.length === 0 ? (
          <p className="mt-1.5 flex items-center gap-2 text-sm text-ok">
            <Icon name="check" /> No issues. Every factual claim maps to a verified quote.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 pt-0.5">
                  <Badge tone={issue.severity === "error" ? "bad" : "warn"}>{issue.severity === "error" ? "Fix" : "Check"}</Badge>
                </span>
                <span className="text-ink-soft">
                  {issue.message}
                  {issue.excerpt && <span className="acc mt-0.5 block text-[12px] text-muted">“{issue.excerpt}”</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {draft.guard.claimCheckNote && !draft.guard.issues.some((i) => i.code === "claim_check_unavailable") && (
          <p className="mt-2 text-[13px] text-muted">{draft.guard.claimCheckNote}</p>
        )}
        {draft.guard.claims && draft.guard.claims.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-soft hover:text-ink">Claim audit ({draft.guard.claims.length} statements)</summary>
            <ul className="mt-2 space-y-1.5">
              {draft.guard.claims.map((c, i) => (
                <li key={i} className="text-[13px]">
                  <span>“{c.text}”</span>{" "}
                  <span className="acc text-[12px] text-muted">
                    {c.kind === "prospect_fact" ? (c.supportedBy ? `fact, backed by ${c.supportedBy}` : "fact, unsupported") : c.kind === "sender_claim" ? (c.supportedBy ? `about you, from ${c.supportedBy.replace("_", " ")}` : "about you, unsupported") : "question or opinion"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {detail.drafts.length > 1 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-soft hover:text-ink">Earlier versions ({detail.drafts.length - 1})</summary>
            <ul className="mt-2 space-y-3">
              {detail.drafts
                .slice(0, -1)
                .reverse()
                .map((d) => (
                  <li key={d.id} className="rounded-lg bg-board/60 p-3">
                    <p className="acc text-muted">
                      v{d.version} by {d.author === "ai" ? "Signal Scout" : "you"}, {formatDateTime(d.createdAt)}
                      {detail.approvedVersion === d.version ? ", approved" : ""}
                    </p>
                    <p className="mt-1 font-bold">{d.subject}</p>
                    <p className="mt-1 whitespace-pre-line text-ink-soft">{d.body}</p>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
