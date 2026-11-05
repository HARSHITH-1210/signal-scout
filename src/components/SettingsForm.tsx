"use client";

import { useState, type FormEvent } from "react";
import type { SenderProfile, StoredDocument } from "@/lib/types";
import type { ReactNode } from "react";
import { DocumentChip, DropZone } from "./DropZone";
import { TextArea, TextField } from "./Field";
import { Icon } from "./Icon";
import { send } from "./run/api";

const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-action px-5 text-sm font-bold text-white transition-colors hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45";

type Suggestion = Partial<Record<keyof SenderProfile, string | null>>;

export function SettingsForm({ initial, initialDocuments, aside }: { initial: SenderProfile; initialDocuments: StoredDocument[]; aside?: ReactNode }) {
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [docs, setDocs] = useState(initialDocuments);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const dirty = (Object.keys(values) as (keyof SenderProfile)[]).some((k) => values[k] !== saved[k]);
  const set = (key: keyof SenderProfile) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setStatus(null);
    if (errors[key]) setErrors((err) => ({ ...err, [key]: "" }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setStatus(null);
    const result = await send("/api/settings", "PUT", values);
    setBusy(null);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setStatus({ tone: "bad", text: result.error });
      return;
    }
    const profile = (result.data as { profile: SenderProfile }).profile;
    setSaved(profile);
    setValues(profile);
    setErrors({});
    setStatus({ tone: "ok", text: "Saved. New drafts will use this profile." });
  }

  async function fillFrom(doc: StoredDocument) {
    setBusy(`fill-${doc.id}`);
    setStatus(null);
    const result = await send("/api/settings/extract", "POST", { documentId: doc.id });
    setBusy(null);
    if (!result.ok) return setStatus({ tone: "bad", text: result.error });
    const suggestion = (result.data as { suggestion: Suggestion }).suggestion;
    const filled = (Object.entries(suggestion) as [keyof SenderProfile, string | null][]).filter(([, v]) => v && v.trim());
    if (filled.length === 0) return setStatus({ tone: "bad", text: `${doc.name} didn't state anything usable for the profile.` });
    setValues((v) => ({ ...v, ...Object.fromEntries(filled.map(([k, val]) => [k, val!.trim()])) }));
    setStatus({ tone: "ok", text: `Filled ${filled.length} field${filled.length === 1 ? "" : "s"} from ${doc.name}. Review them, then save.` });
  }

  async function removeDoc(doc: StoredDocument) {
    const result = await send(`/api/documents/${doc.id}`, "DELETE");
    if (result.ok) setDocs((d) => d.filter((x) => x.id !== doc.id));
    else setStatus({ tone: "bad", text: result.error });
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={submit} noValidate className="self-start rounded-[var(--radius-panel)] border border-rule bg-paper p-5 sm:p-6">
        <fieldset>
          <legend className="text-[15px] font-bold">You</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField label="Your name" name="senderName" value={values.senderName} onChange={set("senderName")} error={errors.senderName} hint="Used to sign drafts." />
            <TextField label="Your role" name="senderRole" value={values.senderRole} onChange={set("senderRole")} error={errors.senderRole} />
            <TextField label="Company" name="companyName" value={values.companyName} onChange={set("companyName")} error={errors.companyName} />
            <TextField label="Company website" name="companyWebsite" value={values.companyWebsite} onChange={set("companyWebsite")} error={errors.companyWebsite} hint="The only link a draft may include." inputMode="url" />
          </div>
        </fieldset>
        <fieldset className="mt-7">
          <legend className="text-[15px] font-bold">What you sell</legend>
          <div className="mt-3 space-y-4">
            <TextArea label="What you offer" name="offering" rows={3} value={values.offering} onChange={set("offering")} error={errors.offering} />
            <TextArea label="Value proposition" name="valueProp" rows={3} value={values.valueProp} onChange={set("valueProp")} error={errors.valueProp} hint="The outcome a customer gets, in one or two sentences." />
            <TextField label="Call to action" name="callToAction" value={values.callToAction} onChange={set("callToAction")} error={errors.callToAction} hint="What you want the prospect to agree to, such as a 20-minute call." />
          </div>
        </fieldset>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={busy !== null || !dirty} className={primary}>
            {busy === "save" ? "Saving…" : "Save profile"}
          </button>
          {dirty && busy === null && (
            <button type="button" onClick={() => setValues(saved)} className="min-h-11 text-sm font-bold text-ink-soft hover:text-ink">
              Discard changes
            </button>
          )}
          <p role="status" className={`text-sm ${status?.tone === "bad" ? "text-specimen" : "text-ok"}`}>
            {status?.text ?? (!dirty ? <span className="text-muted">All changes saved.</span> : null)}
          </p>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section aria-labelledby="seller-docs" className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5">
          <h2 id="seller-docs" className="text-[15px] font-bold">
            Your documents
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            One-pagers, decks or case studies. Drafts draw on them for claims about your product, and the claim audit checks those claims against them.
          </p>
          <div className="mt-4">
            <DropZone scope="sender" onUploaded={(r) => setDocs((d) => [r.document, ...d])} title="Drop a PDF or CSV" hint="Up to 10 MB. Text PDFs only." />
          </div>
          {docs.length > 0 && (
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-2">
                  <DocumentChip doc={doc} onRemove={() => removeDoc(doc)} />
                  <button
                    type="button"
                    onClick={() => fillFrom(doc)}
                    disabled={busy !== null}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-bold text-det hover:bg-det-soft disabled:opacity-45"
                  >
                    <Icon name="doc" className="h-3.5 w-3.5" />
                    {busy === `fill-${doc.id}` ? "Reading…" : "Fill profile from this"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {aside}
      </aside>
    </div>
  );
}
