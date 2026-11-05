"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { validateProspect, type FieldErrors } from "@/lib/pipeline/validate";
import type { ProspectInput, RunSummary, StoredDocument } from "@/lib/types";
import { formatDateTime, RUN_STATUS_LABEL } from "@/lib/ui/format";
import { DocumentChip, DropZone, type UploadResult } from "./DropZone";
import { TextArea, TextField } from "./Field";
import { Icon } from "./Icon";

const EMPTY = { name: "", email: "", role: "", linkedinUrl: "", company: "", companyWebsite: "", notes: "" };
type Values = typeof EMPTY;
const MAX_BATCH = 10;

interface CsvState {
  doc: StoredDocument;
  headers: string[];
  rows: NonNullable<UploadResult["rows"]>;
  chosen: number | null; // row filling the form
  selected: Set<number>; // rows queued as a batch
}

const fromProspect = (p: ProspectInput): Values => ({
  name: p.name ?? "",
  email: p.email ?? "",
  role: p.role ?? "",
  linkedinUrl: p.linkedinUrl ?? "",
  company: p.company ?? "",
  companyWebsite: p.companyWebsite ?? "",
  notes: p.notes ?? "",
});

const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-action px-5 text-sm font-bold text-white transition-colors hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rail px-4 text-sm font-bold text-rail transition-colors hover:bg-board disabled:cursor-not-allowed disabled:opacity-45";

export function NewRunForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [pdfs, setPdfs] = useState<StoredDocument[]>([]);
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<RunSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const attachments = [
    ...pdfs.map((d) => ({ documentId: d.id, rowIndex: null })),
    ...(csv && csv.chosen !== null ? [{ documentId: csv.doc.id, rowIndex: csv.chosen }] : []),
  ];
  // An email alone isn't something to research (it's only used for sending).
  const filled = Object.entries(values).some(([k, v]) => k !== "email" && v.trim() !== "") || attachments.length > 0;

  const set = (key: keyof Values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((err) => (err[key] || err._form ? { ...err, [key]: "", _form: "" } : err));
    setFormError(null);
    setDuplicate(null);
  };

  function onUploaded(result: UploadResult) {
    if (result.document.kind === "pdf") setPdfs((prev) => [...prev, result.document].slice(0, 4));
    else if (result.rows && result.headers) {
      setCsv({ doc: result.document, headers: result.headers, rows: result.rows, chosen: result.rows.length === 1 ? 0 : null, selected: new Set() });
      if (result.rows.length === 1) setValues(fromProspect(result.rows[0].prospect));
    }
  }

  function chooseRow(index: number) {
    if (!csv) return;
    setCsv({ ...csv, chosen: index });
    setValues(fromProspect(csv.rows[index].prospect));
    setErrors({});
    setDuplicate(null);
  }

  function toggleRow(index: number) {
    if (!csv) return;
    const selected = new Set(csv.selected);
    if (selected.has(index)) selected.delete(index);
    else if (selected.size < MAX_BATCH) selected.add(index);
    setCsv({ ...csv, selected });
  }

  async function submit(event: FormEvent | null, force = false) {
    event?.preventDefault();
    setFormError(null);
    const local = validateProspect(values, { allowEmpty: attachments.length > 0 });
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, documents: attachments, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        setDuplicate(data.duplicate);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setErrors(data.fieldErrors ?? {});
        setFormError(data.error ?? `The run couldn't be started (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      router.push(`/runs/${data.id}`);
    } catch {
      setFormError("Couldn't reach the server. Check that it's running and try again.");
      setSubmitting(false);
    }
  }

  async function runBatch() {
    if (!csv || csv.selected.size === 0) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/runs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: csv.doc.id, rowIndexes: [...csv.selected].sort((a, b) => a - b) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "The runs couldn't be started.");
        setSubmitting(false);
        return;
      }
      router.push("/runs");
    } catch {
      setFormError("Couldn't reach the server. Check that it's running and try again.");
      setSubmitting(false);
    }
  }

  const message = formError ?? errors._form;

  return (
    <div className="space-y-6">
      <section aria-labelledby="files-title" className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5 sm:p-6">
        <h2 id="files-title" className="text-[15px] font-bold">
          Start from a file <span className="font-normal text-muted">(optional)</span>
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          An account brief or call notes (PDF) become evidence: their quotes are verified like web pages. A CSV of leads lets you pick a row, or queue several.
        </p>
        <div className="mt-4">
          <DropZone scope="prospect" onUploaded={onUploaded} title="Drop a PDF or CSV here" hint="Up to 10 MB each. Text PDFs only; scans can't be read." />
        </div>
        {(pdfs.length > 0 || csv) && (
          <div className="flex flex-wrap gap-2">
            {pdfs.map((d) => (
              <DocumentChip key={d.id} doc={d} onRemove={() => setPdfs((prev) => prev.filter((x) => x.id !== d.id))} />
            ))}
            {csv && <DocumentChip doc={csv.doc} detail={csv.chosen !== null ? `row ${csv.chosen + 1} of ${csv.rows.length}` : `${csv.rows.length} rows`} onRemove={() => setCsv(null)} />}
          </div>
        )}

        {csv && csv.rows.length > 1 && (
          <div className="mt-4">
            <p className="text-sm text-ink-soft">
              <span className="font-bold text-ink">Pick a row</span> to fill the form, or tick up to {MAX_BATCH} to research them all.
            </p>
            <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-rule">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="sticky top-0 bg-board text-muted">
                  <tr>
                    <th className="w-10 px-2 py-2">
                      <span className="sr-only">Queue</span>
                    </th>
                    <th className="px-2 py-2 font-bold">#</th>
                    <th className="px-2 py-2 font-bold">Name</th>
                    <th className="px-2 py-2 font-bold">Role</th>
                    <th className="px-2 py-2 font-bold">Company</th>
                    <th className="px-2 py-2 font-bold">Website</th>
                    <th className="px-2 py-2">
                      <span className="sr-only">Fill form</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {csv.rows.map((row) => {
                    const p = row.prospect;
                    const empty = !Object.values(p).some(Boolean);
                    return (
                      <tr key={row.index} className={`border-t border-rule-soft ${csv.chosen === row.index ? "bg-det-soft/50" : ""}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Queue row ${row.index + 1}`}
                            className="h-4 w-4"
                            disabled={empty || (!csv.selected.has(row.index) && csv.selected.size >= MAX_BATCH)}
                            checked={csv.selected.has(row.index)}
                            onChange={() => toggleRow(row.index)}
                          />
                        </td>
                        <td className="acc px-2 py-1.5 text-muted">{row.index + 1}</td>
                        <td className="px-2 py-1.5 font-bold">{p.name ?? <span className="font-normal text-muted">none</span>}</td>
                        <td className="px-2 py-1.5 text-ink-soft">{p.role}</td>
                        <td className="px-2 py-1.5 text-ink-soft">{p.company}</td>
                        <td className="acc px-2 py-1.5 text-muted">{p.companyWebsite}</td>
                        <td className="px-2 py-1.5 text-right">
                          <button type="button" disabled={empty} onClick={() => chooseRow(row.index)} className="min-h-8 rounded-md px-2 font-bold text-det hover:bg-det-soft disabled:opacity-40">
                            {csv.chosen === row.index ? "In form" : "Use"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {csv.selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={runBatch} disabled={submitting} className={secondary}>
                  <Icon name="table" />
                  Research {csv.selected.size} selected {csv.selected.size === 1 ? "row" : "rows"}
                </button>
                <span className="text-[13px] text-muted">Each row is its own run and uses its own search and model quota.</span>
              </div>
            )}
          </div>
        )}
      </section>

      <form onSubmit={(e) => submit(e)} noValidate className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5 sm:p-6">
        <fieldset>
          <legend className="text-[15px] font-bold">The person</legend>
          <div className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Full name" name="name" value={values.name} onChange={set("name")} error={errors.name} placeholder="Priya Raman" autoComplete="off" />
              <TextField
                label="Email"
                name="email"
                type="email"
                value={values.email}
                onChange={set("email")}
                error={errors.email}
                placeholder="priya@northwindfreight.com"
                hint="Only used to send the approved draft. Never researched or shown to the AI."
                autoComplete="off"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Role" name="role" value={values.role} onChange={set("role")} error={errors.role} placeholder="VP Finance" />
              <TextField label="LinkedIn profile" name="linkedinUrl" value={values.linkedinUrl} onChange={set("linkedinUrl")} error={errors.linkedinUrl} placeholder="linkedin.com/in/priya-raman" inputMode="url" />
            </div>
          </div>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="text-[15px] font-bold">Their company</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField label="Company" name="company" value={values.company} onChange={set("company")} error={errors.company} placeholder="Northwind Freight" />
            <TextField label="Website" name="companyWebsite" value={values.companyWebsite} onChange={set("companyWebsite")} error={errors.companyWebsite} placeholder="northwindfreight.com" inputMode="url" />
          </div>
        </fieldset>

        <div className="mt-7">
          <TextArea label="Anything else" name="notes" rows={2} value={values.notes} onChange={set("notes")} error={errors.notes} hint="Context only you know, like ‘met at SaaStr’. It can be referenced in the draft." />
        </div>

        {duplicate && (
          <div role="alert" className="mt-6 rounded-lg border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm text-ochre">
            <p>
              You researched this prospect {formatDateTime(duplicate.createdAt)} ({RUN_STATUS_LABEL[duplicate.status].toLowerCase()}). Re-running costs another search and draft.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href={`/runs/${duplicate.id}`} className="font-bold underline">
                Open that run
              </Link>
              <button type="button" onClick={() => submit(null, true)} className="font-bold underline">
                Run again anyway
              </button>
            </div>
          </div>
        )}
        {message && (
          <p role="alert" className="mt-6 rounded-lg bg-specimen-soft px-3 py-2 text-sm text-specimen">
            {message}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={submitting || !filled} className={primary}>
            {submitting ? "Starting…" : "Start research"}
          </button>
          {!filled && <span className="text-sm text-muted">Fill in any one field or attach a file to start.</span>}
        </div>
      </form>
    </div>
  );
}
