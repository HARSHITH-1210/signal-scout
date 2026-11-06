"use client";

import { useState } from "react";
import { parseRelationshipLines } from "@/lib/pipeline/contacts";
import type { ContactRules } from "@/lib/types";
import { TextArea } from "./Field";
import { send } from "./run/api";

const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-obsidian px-4 text-sm font-bold text-obsidian transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-45";

const toText = (rules: ContactRules) => ({
  doNotContact: rules.doNotContact.join("\n"),
  relationships: rules.relationships.map((r) => (r.note ? `${r.match}: ${r.note}` : r.match)).join("\n"),
});

/** The rep's own contact list, checked before any research and before any send. */
export function ContactRulesPanel({ initial }: { initial: ContactRules }) {
  const [saved, setSaved] = useState(toText(initial));
  const [values, setValues] = useState(saved);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = values.doNotContact !== saved.doNotContact || values.relationships !== saved.relationships;

  async function save() {
    setBusy(true);
    setStatus(null);
    const rules: ContactRules = {
      doNotContact: values.doNotContact.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      relationships: parseRelationshipLines(values.relationships),
    };
    const result = await send("/api/settings/contacts", "PUT", rules);
    setBusy(false);
    if (!result.ok) return setStatus({ tone: "bad", text: result.error });
    const next = toText((result.data as { rules: ContactRules }).rules);
    setSaved(next);
    setValues(next);
    setStatus({ tone: "ok", text: "Saved. New runs are checked against this list before any research." });
  }

  return (
    <section aria-labelledby="contacts-title" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="contacts-title" className="text-[15px] font-bold">
        Contact list
      </h2>
      <p className="mt-1 text-sm text-fg-soft">Checked before researching anyone. One email, domain or company per line.</p>
      <div className="mt-4 space-y-4">
        <TextArea
          label="Do not contact"
          name="doNotContact"
          rows={3}
          value={values.doNotContact}
          onChange={(e) => setValues((v) => ({ ...v, doNotContact: e.target.value }))}
          placeholder={"priya@example.com\nexample.com"}
          hint="Opt-outs. Never researched, never sent to."
        />
        <TextArea
          label="Existing relationships"
          name="relationships"
          rows={3}
          value={values.relationships}
          onChange={(e) => setValues((v) => ({ ...v, relationships: e.target.value }))}
          placeholder={"acme.com: customer since 2023\nGlobex: open deal, owner Sam"}
          hint="Customers, open deals, past contacts. The run stops and shows your note."
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !dirty} className={secondary}>
          {busy ? "Saving…" : "Save list"}
        </button>
        {status && (
          <p role="status" className={`text-sm ${status.tone === "bad" ? "text-danger" : "text-ok"}`}>
            {status.text}
          </p>
        )}
      </div>
    </section>
  );
}
