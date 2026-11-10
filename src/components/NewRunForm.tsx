"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { validateProspect, type FieldErrors } from "@/lib/pipeline/validate";
import type { ProspectInput, RunSummary, Sector, StoredDocument } from "@/lib/types";
import { formatDateTime, RUN_STATUS_LABEL } from "@/lib/ui/format";
import { DocumentChip, DropZone, type UploadResult } from "./DropZone";
import { PitchPicker, type PitchSelection } from "./PitchPicker";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT, RISE_IN, SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Spinner } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { TField, TSection, TTextArea, T_PILL, T_PILL_PRIMARY } from "./ui/telemetry";

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


export function NewRunForm({ sectors, prefill }: { sectors: Sector[]; prefill?: Partial<Values> }) {
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
  const [values, setValues] = useState<Values>({ ...EMPTY, ...prefill });
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
  const chosen = csv && csv.chosen !== null ? csv.rows[csv.chosen] : null;

  const csvTable = csv && csv.rows.length > 1 && (
    <div className="mt-5">
      <p className="t-label">{mode === "list" ? `Tick up to ${MAX_BATCH} rows · each becomes its own run` : "Pick a row to fill the form"}</p>
      <div className="mt-2.5 max-h-80 overflow-auto rounded-2xl border border-[var(--t-line)]">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-[var(--t-card)]">
            <tr className="border-b border-[var(--t-line)]">
              {mode === "list" && (
                <th className="w-10 px-4 py-2.5">
                  <span className="sr-only">Queue</span>
                </th>
              )}
              <th className="t-label px-3 py-2.5 font-normal">#</th>
              <th className="t-label px-3 py-2.5 font-normal">Name</th>
              <th className="t-label px-3 py-2.5 font-normal">Role</th>
              <th className="t-label px-3 py-2.5 font-normal">Company</th>
              <th className="t-label px-3 py-2.5 font-normal">Website</th>
              {mode === "single" && (
                <th className="px-3 py-2.5">
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
                <tr key={row.index} className={cn("border-t border-[var(--t-line)] transition-colors first:border-0", picked && "bg-[var(--t-pill-hover)]")}>
                  {mode === "list" && (
                    <td className="px-4 py-2">
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
                  <td className="t-mono px-3 py-2.5 text-[11px] text-[var(--t-muted)]">{String(row.index + 1).padStart(2, "0")}</td>
                  <td className="px-3 py-2.5 font-medium">{p.name ?? <span className="font-normal text-[var(--t-muted)]">none</span>}</td>
                  <td className="px-3 py-2.5 text-[var(--t-soft)]">{p.role}</td>
                  <td className="px-3 py-2.5 text-[var(--t-soft)]">{p.company}</td>
                  <td className="t-mono px-3 py-2.5 text-[11px] text-[var(--t-muted)]">{p.companyWebsite}</td>
                  {mode === "single" && (
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={empty}
                        onClick={() => chooseRow(row.index)}
                        className={cn(
                          "t-mono min-h-8 rounded-full px-3 text-[11px] uppercase tracking-[0.1em] transition-colors disabled:opacity-40",
                          csv.chosen === row.index ? "bg-[var(--t-inv-bg)] text-[var(--t-inv-btn)]" : "border border-[var(--t-line)] hover:border-[var(--t-muted)]",
                        )}
                      >
                        {csv.chosen === row.index ? "In form" : "Use"}
                      </button>
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
    <div className="mt-3 flex flex-wrap gap-2">
      {pdfs.map((d) => (
        <DocumentChip key={d.id} variant="telemetry" doc={d} onRemove={() => setPdfs((prev) => prev.filter((x) => x.id !== d.id))} />
      ))}
      {csv && <DocumentChip variant="telemetry" doc={csv.doc} detail={csv.chosen !== null ? `row ${csv.chosen + 1} of ${csv.rows.length}` : `${csv.rows.length} rows`} onRemove={() => setCsv(null)} />}
    </div>
  );

  const modes: { value: Mode; label: string; count?: number }[] = [
    { value: "single", label: "One prospect" },
    { value: "list", label: "Import a list", count: csv && csv.rows.length > 1 ? csv.rows.length : undefined },
  ];

  return (
    <div className="space-y-3">
      {/* 01 · Pitch */}
      <section aria-labelledby="pitch-title" className="t-card relative overflow-hidden p-5 sm:p-6">
        <span aria-hidden className="t-volt-bg absolute inset-x-0 top-0 h-[2px]" />
        <TSection step="01" title="What are you pitching?" id="pitch-title">
          Offerings come from your sender profile. The choice applies to this run or every row of a list.
        </TSection>
        <PitchPicker sectors={sectors} value={pitch} onChange={setPitch} error={pitchError ?? undefined} />
      </section>

      {/* Mode switch: the Aurora-style pill box used by the navbar. */}
      <div role="tablist" aria-label="How to start" className="inline-flex rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-1">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={mode === m.value}
            onClick={() => setMode(m.value)}
            className={cn("relative rounded-full px-4 py-2 text-[13px] font-medium transition-colors", mode === m.value ? "text-[var(--t-fg)]" : "text-[var(--t-muted)] hover:text-[var(--t-fg)]")}
          >
            {mode === m.value && <motion.span layoutId="new-run-mode" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-[var(--t-pill-active)]" />}
            <span className="relative flex items-center gap-2">
              {m.label}
              {m.count !== undefined && <span className="t-mono text-[11px] text-[var(--t-muted)]">{m.count}</span>}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === "single" ? (
          <motion.div key="single" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <form id="new-run" onSubmit={(e) => submit(e)} noValidate className="t-card divide-y divide-[var(--t-line)]">
              <fieldset className="p-5 sm:p-6">
                <legend className="sr-only">The person</legend>
                <TSection step="02" title="The person" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TField label="Full name" name="name" value={values.name} onChange={set("name")} error={errors.name} autoComplete="off" autoFocus />
                  <TField
                    label="Email"
                    name="email"
                    type="email"
                    value={values.email}
                    onChange={set("email")}
                    error={errors.email}
                    tip="Only used to send the approved draft. Never researched or shown to the AI."
                    autoComplete="off"
                  />
                  <TField label="Role" name="role" value={values.role} onChange={set("role")} error={errors.role} />
                  <TField label="LinkedIn profile" name="linkedinUrl" value={values.linkedinUrl} onChange={set("linkedinUrl")} error={errors.linkedinUrl} inputMode="url" />
                </div>
              </fieldset>

              <fieldset className="p-5 sm:p-6">
                <legend className="sr-only">Their company</legend>
                <TSection step="03" title="Their company" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TField label="Company" name="company" value={values.company} onChange={set("company")} error={errors.company} />
                  <TField label="Website" name="companyWebsite" value={values.companyWebsite} onChange={set("companyWebsite")} error={errors.companyWebsite} inputMode="url" />
                </div>
              </fieldset>

              <div className="p-5 sm:p-6">
                <TSection step="04" title="Context" />
                <TTextArea label="Anything else" name="notes" rows={2} value={values.notes} onChange={set("notes")} error={errors.notes} tip="Context only you know. The draft may reference it." />
              </div>

              <div className="p-5 sm:p-6">
                <TSection step="05" title="Attach a brief">
                  PDF briefs become evidence, and their quotes are verified like web pages. A CSV lets you pick a row.
                </TSection>
                <DropZone variant="telemetry" scope="prospect" onUploaded={onUploaded} title="Drop a PDF or CSV" hint="Optional · up to 10 MB" />
                {chips}
                {csvTable}
              </div>
            </form>
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <section aria-labelledby="list-title" className="t-card p-5 sm:p-6">
              <TSection step="02" title="Research a list of leads" id="list-title">
                Only the rows you tick are used. Each becomes its own run.
              </TSection>
              <DropZone variant="telemetry" scope="prospect" onUploaded={onUploaded} title="Drop a CSV of leads" hint="Up to 10 MB" />
              {chips}
              {csvTable}
              {csv && csv.rows.length <= 1 && <p className="t-mono mt-3 text-[11px] text-[var(--t-muted)]">Single row: added to the One prospect form.</p>}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {duplicate && (
          <motion.div role="alert" {...RISE_IN} exit={{ opacity: 0 }} className="t-card px-5 py-4 text-[13px]">
            <p className="t-label text-[var(--t-warn)]">Researched recently</p>
            <p className="mt-1.5 text-[var(--t-soft)]">
              You researched this prospect {formatDateTime(duplicate.createdAt)} ({RUN_STATUS_LABEL[duplicate.status].toLowerCase()}). Re-running costs another search and draft.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/runs/${duplicate.id}`} className={cn(T_PILL, "border border-[var(--t-line)]")}>
                Open that run →
              </Link>
              <button type="button" onClick={() => submit(null, true)} className={cn(T_PILL, "text-[var(--t-muted)] hover:text-[var(--t-fg)]")}>
                Run again anyway
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {message && (
        <p role="alert" className="t-card t-mono px-5 py-3 text-[12px] text-[var(--t-bad)]">
          {message}
        </p>
      )}

      {/* One primary action, always in reach: a floating pill bar. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-20 pt-2">
        <div className="inline-flex items-center gap-3 rounded-full border border-[var(--t-pill-line)] bg-[color-mix(in_oklab,var(--canvas)_80%,transparent)] p-1.5 shadow-[var(--shadow-overlay)] backdrop-blur-[18px]">
          {mode === "single" ? (
            <>
              <Tooltip align="start" content={!filled ? "Fill in any field or attach a file to start." : "Takes about a minute. You review everything before it's sent."}>
                <button type="submit" form="new-run" disabled={submitting || !filled} className={T_PILL_PRIMARY}>
                  {submitting && <Spinner />}
                  {submitting ? "Starting…" : "Start research →"}
                </button>
              </Tooltip>
              {chosen && <span className="t-label pr-3">Row {chosen.index + 1}</span>}
            </>
          ) : (
            <Tooltip align="start" content={!csv || csv.selected.size === 0 ? "Tick the rows to research." : "Each row runs separately with its own search and model quota."}>
              <button type="button" onClick={runBatch} disabled={submitting || !csv || csv.selected.size === 0} className={T_PILL_PRIMARY}>
                {submitting && <Spinner />}
                {csv && csv.selected.size > 0 ? `Research ${csv.selected.size} ${csv.selected.size === 1 ? "row" : "rows"} →` : "Research selected rows →"}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
