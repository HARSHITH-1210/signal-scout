"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { validateProspect, type FieldErrors } from "@/lib/pipeline/validate";
import type { ProspectInput, RunSummary, Sector, StoredDocument } from "@/lib/types";
import { formatDateTime, RUN_STATUS_LABEL } from "@/lib/ui/format";
import { DocumentChip, DropZone, type UploadResult } from "./DropZone";
import { TextArea, TextField } from "./Field";
import { Icon } from "./Icon";
import { PitchPicker, type PitchSelection } from "./PitchPicker";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT, RISE_IN, cn } from "@/lib/ui/cn";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Tabs } from "./ui/Tabs";

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

type Mode = "single" | "list";

function SectionHead({ id, title, children }: { id?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {children && <p className="mt-1 text-sm text-fg-muted">{children}</p>}
    </div>
  );
}

export function NewRunForm({ sectors }: { sectors: Sector[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("single");
  const [pitch, setPitchState] = useState<PitchSelection>({ auto: false, offeringIds: [] });
  const [pitchError, setPitchError] = useState<string | null>(null);
  const setPitch = useCallback((next: PitchSelection) => {
    setPitchState(next);
    setPitchError(null);
  }, []);
  const hasOfferings = sectors.some((s) => s.offerings.length > 0);
  const pitchReady = !hasOfferings || pitch.auto || pitch.offeringIds.length > 0;
  const pitchBody = { autoPitch: pitch.auto, offeringIds: pitch.auto ? [] : pitch.offeringIds };
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
    if (!pitchReady) {
      setPitchError("Choose what you're pitching, or let Signal Scout choose.");
      document.getElementById("pitch-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, documents: attachments, force, ...pitchBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        setDuplicate(data.duplicate);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        if (data.fieldErrors?.pitch) setPitchError(data.fieldErrors.pitch);
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
    if (!pitchReady) {
      setPitchError("Choose what you're pitching, or let Signal Scout choose.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/runs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: csv.doc.id, rowIndexes: [...csv.selected].sort((a, b) => a - b), ...pitchBody }),
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

  const csvTable = csv && csv.rows.length > 1 && (
    <div className="mt-4">
      <p className="text-sm text-fg-muted">
        {mode === "list" ? (
          <>
            <span className="font-medium text-fg">Tick up to {MAX_BATCH} rows</span> to research them all. Each row becomes its own run.
          </>
        ) : (
          <>
            <span className="font-medium text-fg">Pick a row</span> to fill the form.
          </>
        )}
      </p>
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-subtle text-[12px] text-fg-muted">
            <tr>
              {mode === "list" && (
                <th className="w-10 px-3 py-2">
                  <span className="sr-only">Queue</span>
                </th>
              )}
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Company</th>
              <th className="px-2 py-2 font-medium">Website</th>
              {mode === "single" && (
                <th className="px-2 py-2">
                  <span className="sr-only">Fill form</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {csv.rows.map((row) => {
              const p = row.prospect;
              const empty = !Object.values(p).some(Boolean);
              const picked = mode === "single" ? csv.chosen === row.index : csv.selected.has(row.index);
              return (
                <tr key={row.index} className={cn("border-t border-line-soft transition-colors", picked && "bg-accent-soft")}>
                  {mode === "list" && (
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Queue row ${row.index + 1}`}
                        className="h-4 w-4"
                        disabled={empty || (!csv.selected.has(row.index) && csv.selected.size >= MAX_BATCH)}
                        checked={csv.selected.has(row.index)}
                        onChange={() => toggleRow(row.index)}
                      />
                    </td>
                  )}
                  <td className="acc px-2 py-2 text-fg-muted">{row.index + 1}</td>
                  <td className="px-2 py-2 font-medium">{p.name ?? <span className="font-normal text-fg-muted">none</span>}</td>
                  <td className="px-2 py-2 text-fg-soft">{p.role}</td>
                  <td className="px-2 py-2 text-fg-soft">{p.company}</td>
                  <td className="acc px-2 py-2 text-fg-muted">{p.companyWebsite}</td>
                  {mode === "single" && (
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant={csv.chosen === row.index ? "secondary" : "ghost"} disabled={empty} onClick={() => chooseRow(row.index)}>
                        {csv.chosen === row.index ? "In form" : "Use"}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const chips = (pdfs.length > 0 || csv) && (
    <div className="flex flex-wrap gap-2">
      {pdfs.map((d) => (
        <DocumentChip key={d.id} doc={d} onRemove={() => setPdfs((prev) => prev.filter((x) => x.id !== d.id))} />
      ))}
      {csv && <DocumentChip doc={csv.doc} detail={csv.chosen !== null ? `row ${csv.chosen + 1} of ${csv.rows.length}` : `${csv.rows.length} rows`} onRemove={() => setCsv(null)} />}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <SectionHead id="pitch-title" title="What are you pitching?">
          From your sender profile. Applies to this run, or to every row of a list.
        </SectionHead>
        <PitchPicker sectors={sectors} value={pitch} onChange={setPitch} error={pitchError ?? undefined} />
      </Card>

      <Tabs<Mode>
        label="How to start"
        value={mode}
        onChange={setMode}
        items={[
          { value: "single", label: "One prospect" },
          { value: "list", label: "Import a list", count: csv && csv.rows.length > 1 ? csv.rows.length : undefined },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        {mode === "single" ? (
          <motion.div key="single" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <form id="new-run" onSubmit={(e) => submit(e)} noValidate>
              <Card className="p-5 sm:p-6">
                <fieldset>
                  <legend className="text-[15px] font-semibold tracking-[-0.01em]">The person</legend>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField label="Full name" name="name" value={values.name} onChange={set("name")} error={errors.name} placeholder="Priya Raman" autoComplete="off" autoFocus />
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

                <div className="my-7 h-px bg-line-soft" />

                <fieldset>
                  <legend className="text-[15px] font-semibold tracking-[-0.01em]">Their company</legend>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <TextField label="Company" name="company" value={values.company} onChange={set("company")} error={errors.company} placeholder="Northwind Freight" />
                    <TextField label="Website" name="companyWebsite" value={values.companyWebsite} onChange={set("companyWebsite")} error={errors.companyWebsite} placeholder="northwindfreight.com" inputMode="url" />
                  </div>
                </fieldset>

                <div className="mt-6">
                  <TextArea label="Anything else" name="notes" rows={2} value={values.notes} onChange={set("notes")} error={errors.notes} hint="Context only you know, like ‘met at SaaStr’. It can be referenced in the draft." />
                </div>

                <div className="my-7 h-px bg-line-soft" />

                <SectionHead id="files-title" title={<>Attach a brief <span className="font-normal text-fg-muted">(optional)</span></>}>
                  An account brief or call notes (PDF) become evidence: their quotes are verified like web pages. A CSV lets you pick a row.
                </SectionHead>
                <DropZone scope="prospect" onUploaded={onUploaded} title="Drop a PDF or CSV here" hint="Up to 10 MB each. Text PDFs only; scans can't be read." />
                {chips}
                {csvTable}
              </Card>
            </form>
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <Card className="p-5 sm:p-6">
              <SectionHead id="list-title" title="Research a list of leads">
                Upload a CSV, tick the rows to research, and each one runs on its own. Only the rows you pick are used.
              </SectionHead>
              <DropZone scope="prospect" onUploaded={onUploaded} title="Drop a CSV of leads here" hint="Up to 10 MB. Columns are mapped automatically." />
              {chips}
              {csvTable}
              {csv && csv.rows.length <= 1 && <p className="mt-3 text-sm text-fg-muted">This file has a single row, so it was placed in the One prospect form.</p>}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {duplicate && (
          <motion.div role="alert" {...RISE_IN} exit={{ opacity: 0 }} className="rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
            <p>
              You researched this prospect {formatDateTime(duplicate.createdAt)} ({RUN_STATUS_LABEL[duplicate.status].toLowerCase()}). Re-running costs another search and draft.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href={`/runs/${duplicate.id}`} className="font-medium underline">
                Open that run
              </Link>
              <button type="button" onClick={() => submit(null, true)} className="font-medium underline">
                Run again anyway
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {message && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {message}
        </p>
      )}

      {/* One primary action, always in reach. */}
      <div className="glass sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-4 border-t border-line px-4 py-3 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        {mode === "single" ? (
          <>
            <Button type="submit" form="new-run" variant="primary" loading={submitting} disabled={!filled}>
              {!submitting && <Icon name="search" />}
              {submitting ? "Starting…" : "Start research"}
            </Button>
            <span className="text-[13px] text-fg-muted">{filled ? "Takes about a minute. You review everything before anything is sent." : "Fill in any one field or attach a file to start."}</span>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={runBatch} loading={submitting} disabled={!csv || csv.selected.size === 0}>
              {!submitting && <Icon name="table" />}
              {csv && csv.selected.size > 0 ? `Research ${csv.selected.size} ${csv.selected.size === 1 ? "row" : "rows"}` : "Research selected rows"}
            </Button>
            <span className="text-[13px] text-fg-muted">Each row is its own run and uses its own search and model quota.</span>
          </>
        )}
      </div>
    </div>
  );
}
