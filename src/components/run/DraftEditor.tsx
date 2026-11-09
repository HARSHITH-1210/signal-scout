"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Draft, GmailStatus, RunDetail } from "@/lib/types";
import { formatDateTime } from "@/lib/ui/format";
import { diffWords } from "@/lib/ui/diff";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Badge } from "../Badge";
import { Icon, type IconName } from "../Icon";
import { Button, Kbd } from "../ui/Button";
import { useConfirm } from "../ui/Dialog";
import { Collapsible } from "../ui/Motion";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/Toast";
import { InfoTip, Tooltip } from "../ui/Tooltip";
import { send } from "./api";

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

type CheckTone = "block" | "warn" | "info";
interface CheckItem {
  key: string;
  tone: CheckTone;
  icon: IconName;
  title: string;
  children?: React.ReactNode;
}

const CHECK_STYLE: Record<CheckTone, { chip: string; text: string }> = {
  block: { chip: "bg-danger-soft text-danger", text: "text-fg" },
  warn: { chip: "bg-warn-soft text-warn", text: "text-fg" },
  info: { chip: "bg-subtle text-fg-muted", text: "text-fg-soft" },
};

/** One prioritised list of everything the rep should know before sending: blockers first. */
function BeforeYouSend({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return null;
  const order: Record<CheckTone, number> = { block: 0, warn: 1, info: 2 };
  const sorted = [...items].sort((a, b) => order[a.tone] - order[b.tone]);
  const blocking = items.filter((i) => i.tone === "block").length;
  return (
    <div className="border-b border-line px-5 py-4">
      <p className="flex items-center justify-between text-[12px] font-medium uppercase tracking-wider text-fg-muted">
        Before you send
        {blocking > 0 && <span className="normal-case tracking-normal text-danger">{blocking} to resolve</span>}
      </p>
      <ul className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {sorted.map((item) => (
            <motion.li key={item.key} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="flex gap-3">
              <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", CHECK_STYLE[item.tone].chip)}>
                <Icon name={item.icon} className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 text-sm">
                {/* Informational items keep only their title; detail goes in a tooltip. Blocking items keep their controls inline. */}
                <p className={cn("flex items-center gap-1.5 font-medium", CHECK_STYLE[item.tone].text)}>
                  {item.title}
                  {item.tone === "info" && item.children && (
                    <InfoTip label={`About: ${item.title}`} align="end">
                      {item.children}
                    </InfoTip>
                  )}
                </p>
                {item.tone !== "info" && item.children && <div className="mt-0.5 text-[13px] text-fg-muted">{item.children}</div>}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg-soft">
      {diffWords(before, after).map((part, i) =>
        part.kind === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "added" ? (
          <ins key={i} className="rounded-sm bg-ok-soft text-ok no-underline">
            {part.text}
          </ins>
        ) : (
          <del key={i} className="rounded-sm bg-danger-soft text-danger/80">
            {part.text}
          </del>
        ),
      )}
    </p>
  );
}

interface EditorProps {
  detail: RunDetail;
  gmail: GmailStatus;
  onChanged: () => void;
  onResumed: () => void;
}

/** Keyed by draft id in RunView, so a new version remounts the editor with fresh state. */
export function DraftEditor(props: EditorProps) {
  const draft = props.detail.drafts[props.detail.drafts.length - 1] as Draft | undefined;
  return draft ? <DraftEditorBody {...props} draft={draft} /> : null;
}

function DraftEditorBody({ detail, gmail, onChanged, onResumed, draft }: EditorProps & { draft: Draft }) {
  const previous = detail.drafts.length > 1 ? detail.drafts[detail.drafts.length - 2] : undefined;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [acknowledged, setAcknowledged] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [factsChecked, setFactsChecked] = useState(false);
  const [to, setTo] = useState(detail.sent?.to ?? detail.prospect.email ?? "");
  const titleId = useId();
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const primaryRef = useRef<() => void>(() => undefined);
  const saveRef = useRef<() => void>(() => undefined);

  const dirty = subject !== draft.subject || body !== draft.body;

  // Unsaved edits survive an accidental close or reload prompt.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // ⌘S saves, ⌘↵ runs the primary action (which still confirms before sending), E jumps to the message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      } else if (mod && e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement && e.target !== bodyRef.current)) {
        e.preventDefault();
        primaryRef.current();
      } else if (e.key.toLowerCase() === "e" && !mod && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        bodyRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const errors = draft.guard.issues.filter((i) => i.severity === "error");
  const warnings = draft.guard.issues.filter((i) => i.severity === "warning");
  const approved = detail.status === "approved" && detail.approvedVersion === draft.version;
  const sent = detail.status === "sent" ? detail.sent : null;
  // The claim audit couldn't run: sending waits for the rep's word that every fact was checked.
  const unaudited = draft.guard.issues.some((i) => i.code === "claim_check_unavailable");
  const sendBlocked = unaudited && !factsChecked;
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
    const result = await run();
    setBusy(null);
    if (result.ok) {
      toast({ tone: "ok", title: success });
      after?.();
    } else {
      toast({ tone: "bad", title: "That didn't go through", description: result.error ?? "Something went wrong." });
      // Another tab moved the draft on, or the approval went through but the send didn't: reload either way.
      const data = result.data as { latest?: unknown; status?: string } | undefined;
      if (data?.latest || data?.status) onChanged();
    }
  }

  const save = () => act("save", () => send(`/api/runs/${detail.id}/draft`, "PUT", { subject, body, baseVersion: draft.version }), "Saved as a new version. Length, tone and link checks ran on your edit.", onChanged);
  const approve = () =>
    act("approve", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "approve", version: draft.version, acknowledgeBadNews: acknowledged }), `Version ${draft.version} approved. Nothing was sent.`, onChanged);
  /** Sending can't be undone, so the rep confirms the exact recipient and sender first. */
  const confirmSend = () =>
    confirm({
      title: `Send version ${draft.version}?`,
      description: "This sends a real email through Gmail and can't be undone.",
      confirmLabel: "Send email",
      body: (
        <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-line bg-subtle/50 p-4 text-sm">
          <dt className="text-fg-muted">To</dt>
          <dd className="truncate font-medium">{to.trim()}</dd>
          <dt className="text-fg-muted">From</dt>
          <dd className="truncate">{gmail.email}</dd>
          <dt className="text-fg-muted">Subject</dt>
          <dd className="break-words">{draft.subject}</dd>
        </dl>
      ),
    });
  const approveAndSend = async () => {
    if (!(await confirmSend())) return;
    void act(
      "approve",
      () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "approve", version: draft.version, send: true, to: to.trim(), acknowledgeBadNews: acknowledged, acknowledgeUnaudited: factsChecked }),
      `Approved and sent to ${to.trim()}.`,
      onChanged,
    );
  };
  const sendNow = async () => {
    if (!(await confirmSend())) return;
    void act("send", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: "send", version: draft.version, to: to.trim(), acknowledgeUnaudited: factsChecked }), `Sent to ${to.trim()}.`, onChanged);
  };
  async function researchAgain() {
    setBusy("rerun");
    const result = await send("/api/runs", "POST", {
      ...detail.prospect,
      documents: detail.documents.map((d) => ({ documentId: d.documentId, rowIndex: d.rowIndex })),
      force: true,
    });
    setBusy(null);
    if (!result.ok) return toast({ tone: "bad", title: "Couldn't start a new run", description: result.error });
    router.push(`/runs/${(result.data as { id: string }).id}`);
  }
  /** Asks the AI to apply the rep's instruction; a changed email comes back as a new, fully re-checked version. */
  async function reviseWithAi() {
    const text = instruction.trim();
    if (!text) return;
    setBusy("revise");
    setAiAnswer(null);
    const result = await send(`/api/runs/${detail.id}/draft/revise`, "POST", { instruction: text, subject, body, baseVersion: draft.version });
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "bad", title: "The AI edit didn't go through", description: result.error });
      if ((result.data as { latest?: unknown } | undefined)?.latest) onChanged();
      return;
    }
    const data = result.data as { changed: boolean; reply: string };
    if (data.changed) {
      // The new version remounts this editor; its AI note and diff are shown from the saved draft.
      onChanged();
    } else {
      setAiAnswer(data.reply);
    }
  }

  const regenerate = () =>
    act("regenerate", () => send(`/api/runs/${detail.id}/draft`, "POST", { action: draft.kind === "role_based" ? "role_based" : "regenerate" }), "Writing a new version from the same research.", onResumed);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast({ tone: "ok", title: "Email copied to clipboard" });
    } catch {
      toast({ tone: "bad", title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the text and copy it manually." });
    }
  }

  // The primary action and, when it's unavailable, the reason in plain words.
  const primary: { label: string; busyLabel: string; run: () => void; disabled: boolean; reason: string | null; help: string; busyKey: string } | null = sent
    ? null
    : approved
      ? gmail.connected
        ? {
            label: "Send now",
            help: "Sends this exact version from your Gmail after you confirm.",
            busyLabel: "Sending…",
            busyKey: "send",
            run: sendNow,
            disabled: dirty || !toValid || expired || sendBlocked || busy !== null,
            reason: dirty ? "Save and re-approve your edits before sending." : !toValid ? "Add a valid recipient address." : expired ? "This draft has expired." : sendBlocked ? "Confirm you've checked the facts." : null,
          }
        : null
      : autoSend
        ? {
            label: "Approve & send",
            help: "Emails this exact version after you confirm.",
            busyLabel: "Sending…",
            busyKey: "approve",
            run: approveAndSend,
            disabled: dirty || !toValid || onHold || sendBlocked || busy !== null,
            reason: dirty ? "Save your edits before approving." : !toValid ? "Add a valid recipient address." : onHold ? "Resolve the items above first." : sendBlocked ? "Confirm you've checked the facts." : null,
          }
        : {
            label: `Approve v${draft.version}`,
            help: gmail.connected ? "Records that you reviewed this exact version. Send it afterwards." : "Records that you reviewed this exact version. Nothing is sent.",
            busyLabel: "Approving…",
            busyKey: "approve",
            run: approve,
            disabled: dirty || onHold || busy !== null,
            reason: dirty ? "Save your edits before approving." : onHold ? "Resolve the items above first." : null,
          };
  // The shortcut handler reads the latest actions through refs, updated after each render.
  useEffect(() => {
    primaryRef.current = () => {
      if (primary && !primary.disabled) primary.run();
    };
    saveRef.current = () => {
      if (!sent && dirty && busy === null) void save();
    };
  });

  const checks: CheckItem[] = [];
  if (expired)
    checks.push({
      key: "expired",
      tone: "block",
      icon: "clock",
      title: `Expired on ${formatDateTime(expiresAt!)}`,
      children: (
        <>
          <p>Research again before sending.</p>
          <Button size="sm" className="mt-2" onClick={researchAgain} loading={busy === "rerun"} disabled={busy !== null && busy !== "rerun"}>
            {busy === "rerun" ? "Starting…" : "Research again"}
          </Button>
        </>
      ),
    });
  if (badNews.length > 0 && !sent)
    checks.push({
      key: "badnews",
      tone: acknowledged || approved ? "warn" : "block",
      icon: "alert",
      title: "On hold: recent bad news",
      children: (
        <>
          <ul className="space-y-0.5">
            {badNews.slice(0, 3).map((s) => (
              <li key={s.id}>{s.claim}</li>
            ))}
          </ul>
          <p className="mt-1">Not used in the draft.</p>
          {!approved && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 font-medium text-fg">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              I&apos;ve read this and still want to reach out now
            </label>
          )}
        </>
      ),
    });
  if (gmail.connected && !sent && unaudited)
    checks.push({
      key: "unaudited",
      tone: factsChecked ? "warn" : "block",
      icon: "shield",
      title: "The automatic claim audit didn't run",
      children: (
        <label className="mt-1 flex cursor-pointer items-start gap-2 font-medium text-fg">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={factsChecked} onChange={(e) => setFactsChecked(e.target.checked)} />
          I&apos;ve checked every fact in this email against the findings myself.
        </label>
      ),
    });
  if (errors.length > 0 && !sent) checks.push({ key: "errors", tone: "block", icon: "cross", title: `${errors.length} check${errors.length === 1 ? "" : "s"} to fix`, children: "See Checks below." });
  if (draft.kind === "role_based") checks.push({ key: "role", tone: "warn", icon: "alert", title: "Role-based draft", children: "No verified hook was found, so this draft deliberately makes no claims about the prospect or their company." });
  if (noName)
    checks.push({
      key: "noname",
      tone: "info",
      icon: "sender",
      title: "No person named; it opens with “Hi there”",
      children: draft.recipientHint ? (
        <>
          Send it to the <strong className="font-medium text-fg">{draft.recipientHint}</strong>
          {detail.identity?.resolvedCompany ? ` at ${detail.identity.resolvedCompany}` : ""}.
        </>
      ) : (
        "Choose who to send it to."
      ),
    });
  if (confidence && confidence.reasons.length > 0)
    checks.push({
      key: "confidence",
      tone: "info",
      icon: "spark",
      title: `Based on ${confidence.basis === "person" ? "the person" : confidence.basis === "company" ? "their company" : "their role only"}`,
      children: confidence.reasons.join(" "),
    });
  if (draft.notes?.pitch?.lead)
    checks.push({
      key: "pitch",
      tone: "info",
      icon: "mail",
      title: `Leads with ${draft.notes.pitch.lead}`,
      children: (
        <>
          {draft.notes.pitch.others.length > 0 ? `Also names ${draft.notes.pitch.others.join(", ")}.` : null}
          {detail.pitch.mode === "auto" && " Chosen by Signal Scout from your offerings."}
        </>
      ),
    });

  const author = (d: Draft) => (d.notes?.revision ? "AI, from your instruction" : d.author === "ai" ? "Signal Scout" : "you");

  return (
    <section aria-labelledby={titleId} className="rounded-[var(--radius-panel)] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
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
        <span className="acc text-fg-muted" title={formatDateTime(draft.createdAt)}>
          v{draft.version} · {author(draft)}
          {expiresAt && !sent && !expired ? ` · use by ${formatDateTime(expiresAt).split(",")[0]}` : ""}
        </span>
      </div>

      {sent && (
        <div className="border-b border-line bg-ok-soft px-5 py-3.5 text-sm text-ok">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="check" />
            Sent version {sent.version} to {sent.to}
          </p>
          <p className="acc mt-1">
            from {sent.from}, {formatDateTime(sent.sentAt)}, Gmail id {sent.messageId}
          </p>
          {sent.tracking && (
            <p className="mt-1 text-[13px]">
              {{ pending: "Waiting for delivery", delivered: "Delivered, no reply yet", replied: "They replied", auto_reply: "Auto-reply received", bounced: "Bounced: the address was rejected" }[sent.tracking.state]}
              {sent.tracking.eventAt ? ` (${formatDateTime(sent.tracking.eventAt)})` : ""}.{" "}
              <Link href="/" className="font-medium underline">
                Outreach
              </Link>
            </p>
          )}
        </div>
      )}

      {!sent && <BeforeYouSend items={checks} />}

      {draft.notes?.revision && !sent && (
        <div className="border-b border-line bg-accent-soft/60 px-5 py-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-fg">
            <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
            Rewritten from your instruction on v{draft.notes.revision.fromVersion}
          </p>
          <p className="acc mt-1 text-fg-muted">“{draft.notes.revision.instruction}”</p>
          <p className="mt-1.5 text-fg-soft">
            <span className="font-medium text-fg">AI note:</span> {draft.notes.revision.reply}
          </p>
          {previous && previous.body !== draft.body && (
            <Collapsible className="mt-2" title={<span className="text-[13px] text-fg-soft">What changed</span>} defaultOpen>
              <div className="rounded-lg border border-line bg-surface p-3">
                <Diff before={previous.body} after={draft.body} />
              </div>
            </Collapsible>
          )}
        </div>
      )}

      {/* The email itself, laid out like a document. */}
      <div className="px-5 pt-2">
        {gmail.connected && !sent && (
          <label className="flex items-center gap-3 border-b border-line-soft py-2.5 text-sm">
            <span className="w-14 shrink-0 text-fg-muted">To</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-describedby={`${titleId}-to`}
              aria-invalid={Boolean(to.trim()) && !toValid}
              className="min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-fg-muted/70"
            />
            {to.trim() && toValid && <Icon name="check" className="h-3.5 w-3.5 text-ok" />}
          </label>
        )}
        {gmail.connected && !sent && (
          <p id={`${titleId}-to`} className="pb-1 pt-1.5 text-[12px] text-fg-muted">
            {!to.trim() ? <span className="text-warn">Add the recipient&apos;s address to send. </span> : !toValid ? <span className="text-danger">This isn&apos;t a valid address. </span> : null}
            Sends from {gmail.email}.
          </p>
        )}
        <label className="flex items-center gap-3 border-b border-line-soft py-2.5 text-sm">
          <span className="w-14 shrink-0 text-fg-muted">Subject</span>
          <input readOnly={Boolean(sent)} value={subject} onChange={(e) => setSubject(e.target.value)} className="min-w-0 flex-1 bg-transparent py-1 font-medium outline-none" />
        </label>
        {!sent && (draft.notes?.alternateSubjects.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 py-2.5 text-[13px]">
            <span className="text-fg-muted">Try:</span>
            {draft.notes!.alternateSubjects.map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => setSubject(alt)}
                className={cn("min-h-8 rounded-full border px-2.5 transition-colors", subject === alt ? "border-obsidian bg-obsidian text-obsidian-ink" : "border-line text-fg-soft hover:border-fg-muted/40 hover:text-fg")}
              >
                {alt}
              </button>
            ))}
          </div>
        )}
        <label className="block">
          <span className="sr-only">Message</span>
          <textarea
            ref={bodyRef}
            readOnly={Boolean(sent)}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(24, Math.max(12, body.split("\n").length + 3))}
            className="mt-3 w-full resize-y rounded-lg bg-transparent px-1 py-2 text-[15px] leading-[1.7] text-fg outline-none transition-colors focus:bg-subtle/40"
          />
        </label>
        <div className="flex items-center justify-between gap-3 pb-3 text-[12px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            {!sent && (
              <>
                <Kbd>E</Kbd> to edit
              </>
            )}
          </span>
          <span className="acc">
            <span className={words > 200 || words < 90 ? "text-warn" : undefined}>{words} words</span> · {body.length} characters
          </span>
        </div>
      </div>

      {/* Sticky action bar: one primary action, Save when dirty, the rest in a menu. */}
      <div className="sticky bottom-0 z-10 border-t border-line bg-surface/90 px-5 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          {primary && (
            <Tooltip align="start" content={primary.disabled && busy === null ? primary.reason : primary.help}>
              <Button variant="primary" onClick={primary.run} disabled={primary.disabled} loading={busy === primary.busyKey}>
                {busy !== primary.busyKey && <Icon name={primary.label.startsWith("Send") || primary.label.includes("send") ? "mail" : "check"} />}
                {busy === primary.busyKey ? primary.busyLabel : primary.label}
                {!primary.disabled && <Kbd className="ml-1">⌘↵</Kbd>}
              </Button>
            </Tooltip>
          )}
          {!sent && !approved && autoSend && (
            <Tooltip content="Records the review. Sends nothing.">
              <Button onClick={approve} disabled={dirty || onHold || busy !== null}>
                Approve only
              </Button>
            </Tooltip>
          )}
          <AnimatePresence initial={false}>
            {!sent && dirty && (
              <motion.span key="save" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
                <Button onClick={save} loading={busy === "save"} disabled={busy !== null && busy !== "save"}>
                  {busy === "save" ? "Saving…" : "Save edits"}
                  <Kbd className="ml-1">⌘S</Kbd>
                </Button>
              </motion.span>
            )}
          </AnimatePresence>
          <div className="ml-auto flex items-center gap-1">
            {!sent && (
              <Button variant="ghost" size="sm" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen} aria-controls={`${titleId}-ai`} disabled={busy !== null && busy !== "revise"}>
                <Icon name="spark" className="h-3.5 w-3.5" />
                Edit with AI
              </Button>
            )}
            <Popover
              label="More draft actions"
              side="top"
              align="end"
              className="w-52"
              triggerClassName={() => "grid h-9 w-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-subtle hover:text-fg"}
              trigger={() => (
                <>
                  <Icon name="more" />
                  <span className="sr-only">More actions</span>
                </>
              )}
            >
              <div className="flex flex-col">
                <button type="button" onClick={copy} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-subtle">
                  <Icon name="copy" className="h-3.5 w-3.5 text-fg-muted" />
                  Copy email
                </button>
                {!sent && (
                  <button type="button" onClick={regenerate} disabled={busy !== null} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-subtle disabled:opacity-45">
                    <Icon name="refresh" className="h-3.5 w-3.5 text-fg-muted" />
                    Write a new version
                  </button>
                )}
              </div>
            </Popover>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {aiOpen && !sent && (
          <motion.div id={`${titleId}-ai`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="overflow-hidden border-t border-line">
            <div className="bg-subtle/40 p-5">
              <label className="block text-sm">
                <span className="font-medium">What should change?</span>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (busy === null) void reviseWithAi();
                    }
                  }}
                  rows={3}
                  maxLength={2000}
                  autoFocus
                  aria-describedby={`${titleId}-ai-help`}
                  className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                />
              </label>
              <p id={`${titleId}-ai-help`} className="sr-only">
                Ask for a rewrite or ask a question. Your unsaved edits are included. New facts can only come from verified findings or from what you state yourself, and the result is checked again before you can approve it.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Tooltip align="start" content="Rewrite or ask a question. New facts can only come from verified findings or what you state, and the result is checked again.">

                  <Button variant="primary" size="sm" onClick={reviseWithAi} disabled={!instruction.trim() || (busy !== null && busy !== "revise")} loading={busy === "revise"}>
                    {busy === "revise" ? "Working…" : "Apply"}
                  </Button>

                </Tooltip>
                <Button size="sm" variant="ghost" onClick={() => setAiOpen(false)} disabled={busy === "revise"}>
                  Close
                </Button>
                <span className="ml-auto flex items-center gap-1 text-[12px] text-fg-muted">
                  <Kbd>⌘↵</Kbd> to apply
                </span>
              </div>
              <AnimatePresence>
                {aiAnswer && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
                    <p className="font-medium">AI answer (the draft is unchanged)</p>
                    <p className="mt-1 whitespace-pre-line text-fg-soft">{aiAnswer}</p>
                    <p className="mt-1 text-[12px] text-fg-muted">Check it against the cited source.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {((detail.error && (detail.status === "awaiting_review" || detail.status === "approved")) || (!sent && !gmail.connected && gmail.configured)) && (
        <div className="border-t border-line px-5 py-3">
          {detail.error && (detail.status === "awaiting_review" || detail.status === "approved") && (
            <p role="alert" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {detail.error}
            </p>
          )}
          {!sent && !gmail.connected && gmail.configured && (
            <a href="/api/auth/signin?next=%2Fsettings%23gmail" className="t-label underline-offset-4 hover:underline">
              Sign in with Google to send from here →
            </a>
          )}
        </div>
      )}

      <div className="border-t border-line px-5 py-4">
        <h3 className="flex items-center justify-between text-sm font-medium">
          Checks on v{draft.version}
          {draft.guard.issues.length === 0 && <Badge tone="ok">All clear</Badge>}
        </h3>
        {draft.guard.issues.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-fg-muted">Every claim maps to a verified quote.</p>
        ) : (
          <ul className="mt-3 space-y-2.5 text-sm">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 pt-0.5">
                  <Badge tone={issue.severity === "error" ? "bad" : "warn"}>{issue.severity === "error" ? "Fix" : "Check"}</Badge>
                </span>
                <span className="text-fg-soft">
                  {issue.message}
                  {issue.excerpt && <span className="acc mt-0.5 block text-fg-muted">“{issue.excerpt}”</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {draft.guard.claimCheckNote && !unaudited && <p className="mt-2 text-[13px] text-fg-muted">{draft.guard.claimCheckNote}</p>}

        <div className="mt-3 divide-y divide-line-soft border-t border-line-soft">
          {(draft.notes?.rationale.length ?? 0) > 0 && (
            <Collapsible className="py-1" title={<span className="text-fg-soft">Why this draft</span>}>
              <ul className="space-y-1.5 text-[13px] text-fg-soft">
                {draft.notes!.rationale.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
                    {r}
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {draft.guard.claims && draft.guard.claims.length > 0 && (
            <Collapsible className="py-1" title={<span className="text-fg-soft">Claim audit ({draft.guard.claims.length} statements)</span>}>
              <ul className="space-y-2">
                {draft.guard.claims.map((c, i) => (
                  <li key={i} className="text-[13px]">
                    <span>“{c.text}”</span>{" "}
                    <span className="acc text-fg-muted">
                      {c.kind === "prospect_fact" ? (c.supportedBy ? `fact, backed by ${c.supportedBy}` : "fact, unsupported") : c.kind === "sender_claim" ? (c.supportedBy ? `about you, from ${c.supportedBy.replace("_", " ")}` : "about you, unsupported") : "question or opinion"}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {detail.drafts.length > 1 && (
            <Collapsible className="py-1" title={<span className="text-fg-soft">Earlier versions ({detail.drafts.length - 1})</span>}>
              <ol className="relative ml-1.5 space-y-4 border-l border-line pl-5">
                {detail.drafts
                  .slice(0, -1)
                  .reverse()
                  .map((d) => (
                    <li key={d.id} className="relative text-sm">
                      <span aria-hidden className={cn("absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface", detail.approvedVersion === d.version ? "bg-ok" : "bg-line")} />
                      <p className="acc text-fg-muted">
                        v{d.version} · {author(d)} · {formatDateTime(d.createdAt)}
                        {detail.approvedVersion === d.version ? " · approved" : ""}
                      </p>
                      {d.notes?.revision && <p className="acc mt-0.5 text-fg-muted">“{d.notes.revision.instruction}”</p>}
                      <p className="mt-1 font-medium">{d.subject}</p>
                      <p className="mt-1 line-clamp-4 whitespace-pre-line text-[13px] text-fg-soft">{d.body}</p>
                    </li>
                  ))}
              </ol>
            </Collapsible>
          )}
        </div>
      </div>
    </section>
  );
}
