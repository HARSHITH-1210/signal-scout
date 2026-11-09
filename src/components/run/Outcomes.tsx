"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunDetail } from "@/lib/types";
import { TextField } from "../Field";
import { Icon } from "../Icon";
import { AnimatePresence, motion } from "motion/react";
import { buttonClass } from "../ui/Button";
import { send } from "./api";

const primary = buttonClass("primary");
const secondary = buttonClass("secondary");

const SHELL_TONE = {
  info: { ring: "border-info/25", head: "text-info", chip: "bg-info-soft text-info", icon: "spark" },
  warn: { ring: "border-warn/30", head: "text-warn", chip: "bg-warn-soft text-warn", icon: "alert" },
  bad: { ring: "border-danger/30", head: "text-danger", chip: "bg-danger-soft text-danger", icon: "cross" },
} as const;

function Shell({ tone, title, children }: { tone: "info" | "warn" | "bad"; title: string; children: React.ReactNode }) {
  const t = SHELL_TONE[tone];
  return (
    <section className={`rounded-[var(--radius-panel)] border ${t.ring} bg-surface p-5 sm:p-6`}>
      <h2 className={`flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em] ${t.head}`}>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${t.chip}`}>
          <Icon name={t.icon} className="h-4 w-4" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function InProgress({ detail }: { detail: RunDetail }) {
  const last = detail.events[detail.events.length - 1];
  return (
    <Shell tone="info" title={detail.status === "queued" ? "Waiting to start" : "Researching"}>
      <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-subtle">
        <span className="skeleton block h-full w-full rounded-full" style={{ backgroundImage: "linear-gradient(90deg, transparent 20%, var(--accent) 50%, transparent 80%)" }} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={last?.id ?? "start"} role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className="mt-3 text-sm text-fg-soft">
          {last ? last.message : "Starting up."}
        </motion.p>
      </AnimatePresence>
      <p className="mt-2 text-[13px] text-fg-muted">Usually 1–3 minutes. Safe to leave this page.</p>
    </Shell>
  );
}

export function Clarify({ detail, onResumed }: { detail: RunDetail; onResumed: () => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [extra, setExtra] = useState({ companyWebsite: "", linkedinUrl: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const candidates = detail.identity?.candidates ?? [];
  const jobChange = /^Possible job change/.test(detail.identity?.reasoning ?? "");

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await send(`/api/runs/${detail.id}/clarify`, "POST", body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }
    onResumed();
  }

  return (
    <Shell tone="warn" title={jobChange ? `Has ${detail.prospect.name ?? "this person"} changed jobs?` : detail.prospect.name ? `Which ${detail.prospect.name} do you mean?` : "Which one do you mean?"}>
      <p className="mt-1 text-sm text-fg-soft">
        {jobChange ? "" : "Public sources describe more than one match. Research is paused so nothing is written about the wrong one. "}
        {detail.identity?.reasoning}
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Candidates</legend>
        {candidates.map((c, i) => (
          <label key={i} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${choice === i ? "border-info bg-info-soft/60" : "border-line hover:border-fg-muted/60"}`}>
            <input type="radio" name="candidate" className="mt-1 h-4 w-4" checked={choice === i} onChange={() => setChoice(i)} />
            <span className="min-w-0">
              <span className="font-medium">
                {c.name}
                {c.role ? `, ${c.role}` : ""}
                {c.company && c.company !== c.name ? ` at ${c.company}` : ""}
              </span>
              <span className="block text-fg-soft">{c.description}</span>
              {c.evidenceUrl && <span className="acc block truncate text-[12px] text-info">{c.evidenceUrl}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <button disabled={choice === null || busy} onClick={() => submit({ candidateIndex: choice })} className={`${primary} mt-3`}>
        Research this one
      </button>

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm font-medium">None of these? Add a detail and search again.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField label="Company website" name="companyWebsite" value={extra.companyWebsite} error={fieldErrors.companyWebsite} onChange={(e) => setExtra({ ...extra, companyWebsite: e.target.value })} placeholder="atlasrobotics.io" />
          <TextField label="LinkedIn profile" name="linkedinUrl" value={extra.linkedinUrl} error={fieldErrors.linkedinUrl} onChange={(e) => setExtra({ ...extra, linkedinUrl: e.target.value })} placeholder="linkedin.com/in/…" />
        </div>
        <div className="mt-3">
          <TextField label="Anything else that narrows it down" name="notes" value={extra.notes} error={fieldErrors.notes} onChange={(e) => setExtra({ ...extra, notes: e.target.value })} placeholder="Based in Austin, robotics company" />
        </div>
        <button disabled={busy || !(extra.companyWebsite || extra.linkedinUrl || extra.notes)} onClick={() => submit(extra)} className={`${secondary} mt-3`}>
          Search again
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function Insufficient({ detail, onResumed }: { detail: RunDetail; onResumed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identityFailed = detail.identity?.status === "not_found";

  async function roleBased() {
    setBusy(true);
    const result = await send(`/api/runs/${detail.id}/draft`, "POST", { action: "role_based" });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onResumed();
  }

  return (
    <Shell tone="warn" title={identityFailed ? "Couldn't confirm who this is" : "No finding strong enough to personalise on"}>
      <p className="mt-1 text-sm text-fg-soft">Not enough verified signal for a grounded email:</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {detail.limitations.map((l, i) => (
          <li key={i} className="flex gap-2 text-fg-soft">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            {l}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!identityFailed && (
          <button onClick={roleBased} disabled={busy} className={secondary}>
            Write a role-based draft instead
          </button>
        )}
        <span className="text-[13px] text-fg-muted">
          {identityFailed ? "Try again with the company website, a LinkedIn profile or an account brief." : "A role-based draft speaks to their role in general and makes no claims about them. It's labelled as such."}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Shell>
  );
}

/** Resume picks up at research or later: earlier stages' outputs are reused. */
function stageLabel(stage: RunDetail["currentStage"]): string {
  if (!stage || stage === "validate") return "the start";
  if (stage === "rank_hook" || stage === "verify") return "extracting signals";
  if (stage === "guard") return "the draft";
  return stage.replace(/_/g, " ").replace("resolve identity", "identity");
}

export function Failed({ detail, onResumed }: { detail: RunDetail; onResumed: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setError(null);
    const result = await send(`/api/runs/${detail.id}/resume`, "POST");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onResumed();
  }

  async function rerun() {
    setBusy(true);
    const result = await send("/api/runs", "POST", {
      ...detail.prospect,
      documents: detail.documents.map((d) => ({ documentId: d.documentId, rowIndex: d.rowIndex })),
      force: true,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(`/runs/${(result.data as { id: string }).id}`);
  }

  return (
    <Shell tone={detail.status === "stopped" ? "info" : "bad"} title={detail.status === "stopped" ? "You stopped this run" : "This run stopped with an error"}>
      <p className="mt-1 text-sm">{detail.error}</p>
      <p className="mt-1 text-[13px] text-fg-muted">
        Everything found before the error is kept below. Resuming continues from {stageLabel(detail.currentStage)} and reuses it, so searches that already ran
        aren&apos;t paid for again.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={resume} disabled={busy} className={primary}>
          <Icon name="refresh" />
          {busy ? "Resuming…" : `Resume from ${stageLabel(detail.currentStage)}`}
        </button>
        <button onClick={rerun} disabled={busy} className={secondary}>
          Run again from the start
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function Held({ detail, onResumed }: { detail: RunDetail; onResumed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = detail.hold;
  if (!hold) return null;
  const optOut = hold.kind === "do_not_contact";

  async function proceed() {
    setBusy(true);
    const result = await send(`/api/runs/${detail.id}/hold`, "POST");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onResumed();
  }

  return (
    <Shell tone={optOut ? "bad" : "warn"} title={optOut ? "Do not contact" : "Existing relationship"}>
      <p className="mt-1 text-sm text-fg-soft">
        {optOut ? (
          <>
            This prospect matches <span className="acc">{hold.match}</span> on your do-not-contact list. Nothing more was researched, and nothing can be sent to them.
          </>
        ) : (
          <>
            This prospect matches <span className="acc">{hold.match}</span> in your existing relationships{hold.note ? `: ${hold.note}` : ""}. Check with the account owner before
            cold outreach.
          </>
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!optOut && (
          <button onClick={proceed} disabled={busy} className={secondary}>
            {busy ? "Starting…" : "Research anyway"}
          </button>
        )}
        <span className="text-[13px] text-fg-muted">Edit the list under Contacts.</span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Shell>
  );
}
