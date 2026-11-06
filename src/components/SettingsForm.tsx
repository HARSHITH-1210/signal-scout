"use client";

import { useState, type FormEvent } from "react";
import type { Offering, Sector, SenderProfile, StoredDocument } from "@/lib/types";
import type { ReactNode } from "react";
import { DocumentChip, DropZone } from "./DropZone";
import { TextArea, TextField } from "./Field";
import { Icon } from "./Icon";
import { send } from "./run/api";

const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-45";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-obsidian px-4 text-sm font-medium text-obsidian transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-45";
const quiet = "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-fg-soft hover:bg-canvas hover:text-danger";

type Identity = Pick<SenderProfile, "senderName" | "senderRole" | "companyName" | "companyWebsite" | "defaultCta">;

interface Suggestion {
  companyName: string | null;
  companyWebsite: string | null;
  defaultCta: string | null;
  sectors: { name: string; offerings: { name: string; whatItDoes: string }[] }[];
}

/** Short random id; crypto.randomUUID isn't available on plain-http LAN addresses. */
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const blankOffering = (): Offering => ({ id: newId("o"), name: "", whatItDoes: "", cta: "", documentIds: [] });

export function SettingsForm({ initial, initialDocuments, aside }: { initial: SenderProfile; initialDocuments: StoredDocument[]; aside?: ReactNode }) {
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [docs, setDocs] = useState(initialDocuments);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const touched = () => setStatus(null);

  const set = (key: keyof Identity) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    touched();
    if (errors[key]) setErrors((err) => ({ ...err, [key]: "" }));
  };
  const updateSectors = (fn: (sectors: Sector[]) => Sector[]) => {
    setValues((v) => ({ ...v, sectors: fn(v.sectors) }));
    touched();
  };
  const updateSector = (s: number, patch: Partial<Sector>) => updateSectors((all) => all.map((x, i) => (i === s ? { ...x, ...patch } : x)));
  const updateOffering = (s: number, o: number, patch: Partial<Offering>) =>
    updateSectors((all) => all.map((x, i) => (i === s ? { ...x, offerings: x.offerings.map((y, j) => (j === o ? { ...y, ...patch } : y)) } : x)));

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
    setStatus({ tone: "ok", text: "Saved. New runs can pitch these offerings." });
  }

  /** Adds what the document states: empty identity fields are filled, offerings are merged into sectors by name. */
  async function fillFrom(doc: StoredDocument) {
    setBusy(`fill-${doc.id}`);
    setStatus(null);
    const result = await send("/api/settings/extract", "POST", { documentId: doc.id });
    setBusy(null);
    if (!result.ok) return setStatus({ tone: "bad", text: result.error });
    const s = (result.data as { suggestion: Suggestion }).suggestion;
    let added = 0;
    setValues((v) => {
      const next = { ...v, sectors: v.sectors.map((x) => ({ ...x, offerings: [...x.offerings] })) };
      for (const key of ["companyName", "companyWebsite", "defaultCta"] as const) {
        const value = s[key]?.trim();
        if (value && !next[key].trim()) {
          next[key] = value;
          added++;
        }
      }
      for (const sector of s.sectors) {
        const offerings = sector.offerings
          .filter((o) => o.name.trim())
          .map((o) => ({ ...blankOffering(), name: o.name.trim(), whatItDoes: o.whatItDoes.trim(), documentIds: [doc.id] }));
        if (offerings.length === 0) continue;
        const existing = next.sectors.find((x) => x.name.trim().toLowerCase() === sector.name.trim().toLowerCase());
        const fresh = offerings.filter((o) => !existing?.offerings.some((e) => e.name.trim().toLowerCase() === o.name.toLowerCase()));
        if (existing) existing.offerings.push(...fresh);
        else next.sectors.push({ id: newId("s"), name: sector.name.trim() || "General", offerings: fresh });
        added += fresh.length;
      }
      return next;
    });
    setStatus(
      added === 0
        ? { tone: "bad", text: `${doc.name} didn't add anything new to the profile.` }
        : { tone: "ok", text: `Added what ${doc.name} states. Review it, then save.` },
    );
  }

  async function removeDoc(doc: StoredDocument) {
    const result = await send(`/api/documents/${doc.id}`, "DELETE");
    if (!result.ok) return setStatus({ tone: "bad", text: result.error });
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    const detach = (p: SenderProfile) => ({ ...p, sectors: p.sectors.map((s) => ({ ...s, offerings: s.offerings.map((o) => ({ ...o, documentIds: o.documentIds.filter((id) => id !== doc.id) })) })) });
    setValues(detach);
    setSaved(detach);
  }

  const offeringCount = values.sectors.reduce((n, s) => n + s.offerings.length, 0);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={submit} noValidate className="self-start rounded-[var(--radius-panel)] border border-line bg-surface p-5 sm:p-6">
        <fieldset>
          <legend className="text-[15px] font-semibold">You</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField label="Your name" name="senderName" value={values.senderName} onChange={set("senderName")} error={errors.senderName} hint="Used to sign drafts." />
            <TextField label="Your role" name="senderRole" value={values.senderRole} onChange={set("senderRole")} error={errors.senderRole} />
            <TextField label="Company" name="companyName" value={values.companyName} onChange={set("companyName")} error={errors.companyName} />
            <TextField label="Company website" name="companyWebsite" value={values.companyWebsite} onChange={set("companyWebsite")} error={errors.companyWebsite} hint="The only link a draft may include." inputMode="url" />
          </div>
          <div className="mt-4">
            <TextField label="Default call to action" name="defaultCta" value={values.defaultCta} onChange={set("defaultCta")} error={errors.defaultCta} hint="What you want the prospect to agree to, such as a 20-minute call. An offering can override it." />
          </div>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="text-[15px] font-semibold">What you sell</legend>
          <p className="mt-1 text-sm text-fg-soft">
            Group your offerings into sectors. Each new run picks one or more to pitch: the email leads with the best fit and names the others in passing.
          </p>
          <div className="mt-4 space-y-4">
            {values.sectors.map((sector, s) => (
              <details key={sector.id} open className="rounded-lg border border-line">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon name="chevron" className="h-4 w-4 text-fg-muted" />
                    {sector.name.trim() || "Untitled sector"}
                  </span>
                  <span className="acc text-fg-muted">{sector.offerings.length === 1 ? "1 offering" : `${sector.offerings.length} offerings`}</span>
                </summary>
                <div className="space-y-4 border-t border-line px-4 pt-3 pb-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <TextField label="Sector name" name={`sectors.${s}.name`} value={sector.name} onChange={(e) => updateSector(s, { name: e.target.value })} error={errors[`sectors.${s}.name`]} placeholder="AI solutions" />
                    </div>
                    <button type="button" onClick={() => updateSectors((all) => all.filter((_, i) => i !== s))} className={`${quiet} mb-1`}>
                      <Icon name="trash" className="h-3.5 w-3.5" />
                      Remove sector
                    </button>
                  </div>

                  {sector.offerings.map((offering, o) => {
                    const key = `sectors.${s}.offerings.${o}`;
                    return (
                      <div key={offering.id} className="rounded-lg bg-canvas/60 p-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-0 flex-1">
                            <TextField label="Offering" name={`${key}.name`} value={offering.name} onChange={(e) => updateOffering(s, o, { name: e.target.value })} error={errors[`${key}.name`]} placeholder="Invoice-processing agents" />
                          </div>
                          <button type="button" onClick={() => updateSector(s, { offerings: sector.offerings.filter((_, j) => j !== o) })} className={`${quiet} mb-1`}>
                            <Icon name="trash" className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 space-y-3">
                          <TextArea label="What it does" name={`${key}.whatItDoes`} rows={3} value={offering.whatItDoes} onChange={(e) => updateOffering(s, o, { whatItDoes: e.target.value })} error={errors[`${key}.whatItDoes`]} />
                          <TextField label="Call to action for this offering" name={`${key}.cta`} value={offering.cta} onChange={(e) => updateOffering(s, o, { cta: e.target.value })} error={errors[`${key}.cta`]} hint="Optional. Leave empty to use the default." />
                          {docs.length > 0 && (
                            <fieldset className="text-sm">
                              <legend className="font-medium">Documents about this offering</legend>
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                {docs.map((doc) => (
                                  <label key={doc.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-fg-soft">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4"
                                      checked={offering.documentIds.includes(doc.id)}
                                      onChange={(e) =>
                                        updateOffering(s, o, {
                                          documentIds: e.target.checked ? [...offering.documentIds, doc.id] : offering.documentIds.filter((id) => id !== doc.id),
                                        })
                                      }
                                    />
                                    {doc.name}
                                  </label>
                                ))}
                              </div>
                              <span className="mt-1 block text-[13px] text-fg-muted">Documents not ticked under any offering are used for every run.</span>
                            </fieldset>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => updateSector(s, { offerings: [...sector.offerings, blankOffering()] })} className={secondary}>
                    <Icon name="plus" />
                    Add offering
                  </button>
                </div>
              </details>
            ))}
            {values.sectors.length === 0 && <p className="text-sm text-warn">No offerings yet. Drafts stay general until you add what you sell.</p>}
            <button type="button" onClick={() => updateSectors((all) => [...all, { id: newId("s"), name: "", offerings: [blankOffering()] }])} className={secondary}>
              <Icon name="plus" />
              Add sector
            </button>
          </div>
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={busy !== null || !dirty} className={primary}>
            {busy === "save" ? "Saving…" : "Save profile"}
          </button>
          {dirty && busy === null && (
            <button type="button" onClick={() => setValues(saved)} className="min-h-11 text-sm font-medium text-fg-soft hover:text-fg">
              Discard changes
            </button>
          )}
          <p role="status" className={`text-sm ${status?.tone === "bad" ? "text-danger" : "text-ok"}`}>
            {status?.text ?? (!dirty ? <span className="text-fg-muted">All changes saved. {offeringCount === 1 ? "1 offering" : `${offeringCount} offerings`}.</span> : null)}
          </p>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section aria-labelledby="seller-docs" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 id="seller-docs" className="text-[15px] font-semibold">
            Your documents
          </h2>
          <p className="mt-1 text-sm text-fg-soft">
            One-pagers, decks or case studies. Drafts draw on them for claims about your offerings, and the claim audit checks those claims against them.
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
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-info hover:bg-info-soft disabled:opacity-45"
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
