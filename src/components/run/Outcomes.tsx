"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunDetail } from "@/lib/types";
import { TextField } from "../Field";
import { Icon } from "../Icon";
import { send } from "./api";

const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-action px-4 text-sm font-bold text-white transition-colors hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rail px-4 text-sm font-bold text-rail transition-colors hover:bg-board disabled:cursor-not-allowed disabled:opacity-45";

function Shell({ tone, title, children }: { tone: "info" | "warn" | "bad"; title: string; children: React.ReactNode }) {
  const ring = tone === "info" ? "border-det/30" : tone === "warn" ? "border-ochre/40" : "border-specimen/40";
  const head = tone === "info" ? "text-det" : tone === "warn" ? "text-ochre" : "text-specimen";
  return (
    <section className={`rounded-[var(--radius-panel)] border ${ring} bg-paper p-5 sm:p-6`}>
      <h2 className={`text-[17px] font-bold ${head}`}>{title}</h2>
      {children}
    </section>
  );
}

export function InProgress({ detail }: { detail: RunDetail }) {
  const last = detail.events[detail.events.length - 1];
  return (
    <Shell tone="info" title={detail.status === "queued" ? "Waiting to start" : "Researching"}>
      <p className="mt-1 text-sm text-ink-soft">{last ? last.message : "Starting up."}</p>
      <p className="mt-2 text-[13px] text-muted">A full run usually takes one to three minutes. You can leave this page; progress is saved and the ledger catches up when you return.</p>
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
      <p className="mt-1 text-sm text-ink-soft">
        {jobChange ? "" : "Public sources describe more than one match. Research is paused so nothing is written about the wrong one. "}
        {detail.identity?.reasoning}
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Candidates</legend>
        {candidates.map((c, i) => (
          <label key={i} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${choice === i ? "border-det bg-det-soft/60" : "border-rule hover:border-muted/60"}`}>
            <input type="radio" name="candidate" className="mt-1 h-4 w-4" checked={choice === i} onChange={() => setChoice(i)} />
            <span className="min-w-0">
              <span className="font-bold">
                {c.name}
                {c.role ? `, ${c.role}` : ""}
                {c.company && c.company !== c.name ? ` at ${c.company}` : ""}
              </span>
              <span className="block text-ink-soft">{c.description}</span>
              {c.evidenceUrl && <span className="acc block truncate text-[12px] text-det">{c.evidenceUrl}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <button disabled={choice === null || busy} onClick={() => submit({ candidateIndex: choice })} className={`${primary} mt-3`}>
        Research this one
      </button>

      <div className="mt-6 border-t border-rule pt-4">
        <p className="text-sm font-bold">None of these? Add one more detail and search again.</p>
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
        <p role="alert" className="mt-3 text-sm text-specimen">
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
      <p className="mt-1 text-sm text-ink-soft">Rather than invent a reason to reach out, Signal Scout stopped here. This is what it found and why it wasn&apos;t enough:</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {detail.limitations.map((l, i) => (
          <li key={i} className="flex gap-2 text-ink-soft">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-ochre" />
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
        <span className="text-[13px] text-muted">
          {identityFailed ? "Try again with the company website, a LinkedIn profile or an account brief." : "A role-based draft speaks to their role in general and makes no claims about them. It's labelled as such."}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-specimen">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function Failed({ detail, onResumed }: { detail: RunDetail; onResumed: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retryDraft() {
    setBusy(true);
    const result = await send(`/api/runs/${detail.id}/draft`, "POST", { action: "regenerate" });
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
    <Shell tone="bad" title="This run stopped with an error">
      <p className="mt-1 text-sm">{detail.error}</p>
      <p className="mt-1 text-[13px] text-muted">Everything found before the error is kept below.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {detail.hook && (
          <button onClick={retryDraft} disabled={busy} className={primary}>
            Retry the draft
          </button>
        )}
        <button onClick={rerun} disabled={busy} className={secondary}>
          Run again from the start
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-specimen">
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
      <p className="mt-1 text-sm text-ink-soft">
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
        <span className="text-[13px] text-muted">Edit the list under Contacts.</span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-specimen">
          {error}
        </p>
      )}
    </Shell>
  );
}
