"use client";

import { useMemo, useRef, useState } from "react";
import { guessColumns, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseTable, planImport, type ImportOptions, type Table } from "@/lib/contacts/importer";
import { ENTRY_KIND_LABEL, RELATIONSHIP_KINDS, relationshipLabel } from "@/lib/contacts/rules";
import type { ContactRules, RelationshipKind } from "@/lib/types";
import { cn } from "@/lib/ui/cn";
import { Icon } from "../Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SegmentedControl } from "../ui/Tabs";

export type ListName = keyof ContactRules;

export const LIST_TITLE: Record<ListName, string> = { doNotContact: "Do not contact", relationships: "Existing relationships" };

export const selectClass =
  "h-10 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

/**
 * Import entries from a CSV file (a CRM export, an unsubscribe list) or pasted text. The file is read
 * in the browser and never uploaded. Columns are guessed and can be changed; a preview shows exactly
 * what will be added, what's already there and what's skipped, before anything changes.
 */
export function ImportDialog({
  open,
  onClose,
  initialTarget,
  rules,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  initialTarget: ListName;
  rules: ContactRules;
  onImport: (target: ListName, added: ContactRules) => void;
}) {
  const [target, setTarget] = useState<ListName>(initialTarget);
  const [source, setSource] = useState<"file" | "paste">("file");
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState(0);
  const [kindColumn, setKindColumn] = useState<number | null>(null);
  const [defaultKind, setDefaultKind] = useState<RelationshipKind>("customer");
  const [notes, setNotes] = useState<number[]>([]);
  const [fallbacks, setFallbacks] = useState<number[]>([]);
  const [useFallbacks, setUseFallbacks] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function load(text: string, name: string | null) {
    const t = parseTable(text);
    if (t.rows.length === 0) {
      setTable(null);
      return setError("No rows found. Use a CSV file with one contact per row, or paste one entry per line.");
    }
    const guess = guessColumns(t);
    setError(null);
    setFileName(name);
    setTable(t);
    setMatch(guess.match);
    setKindColumn(guess.kind);
    setNotes(guess.notes);
    setFallbacks(guess.fallbacks);
    setShowSkipped(false);
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setError(`That file is over ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it, or export only the columns you need.`);
    if (!/\.(csv|tsv|txt)$/i.test(file.name) && !/text|csv/.test(file.type)) return setError("Choose a CSV file (or a TSV or plain-text list). Excel files: save as CSV first.");
    load(await file.text(), file.name);
  }

  function reset() {
    setTable(null);
    setFileName(null);
    setPasted("");
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function close() {
    reset();
    onClose();
  }

  const activeFallbacks = useFallbacks ? fallbacks.filter((c) => c !== match) : [];
  const options: ImportOptions = { target, match, kindColumn, defaultKind, notes, fallbacks: activeFallbacks };
  const existing = target === "doNotContact" ? rules.doNotContact : rules.relationships.map((r) => r.match);
  const plan = useMemo(() => (table ? planImport(table, options, existing) : null), [table, target, match, kindColumn, defaultKind, notes, existing, useFallbacks, fallbacks]); // eslint-disable-line react-hooks/exhaustive-deps
  const added = plan ? (target === "doNotContact" ? plan.doNotContact.length : plan.relationships.length) : 0;
  const sample = (c: number) => table?.rows.find((r) => r[c]?.trim())?.[c] ?? "";

  function confirm() {
    if (!plan || added === 0) return;
    onImport(target, { doNotContact: plan.doNotContact, relationships: plan.relationships });
    close();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import contacts"
      description="From a CSV file (a CRM export or an unsubscribe list) or pasted text. The file is read in your browser; only the entries you add are saved."
      className="max-h-[90vh] max-w-2xl overflow-y-auto"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!plan || added === 0} onClick={confirm}>
            {added > 0 ? `Add ${added.toLocaleString("en")} ${added === 1 ? "entry" : "entries"}` : "Add entries"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="t-label">Add to</span>
          <SegmentedControl<ListName>
            label="List to import into"
            size="sm"
            value={target}
            onChange={setTarget}
            items={[
              { value: "doNotContact", label: LIST_TITLE.doNotContact },
              { value: "relationships", label: LIST_TITLE.relationships },
            ]}
          />
        </div>

        {!table ? (
          <>
            <SegmentedControl<"file" | "paste">
              label="Import from"
              size="sm"
              value={source}
              onChange={(v) => {
                setSource(v);
                setError(null);
              }}
              items={[
                { value: "file", label: "Upload CSV" },
                { value: "paste", label: "Paste" },
              ]}
            />
            {source === "file" ? (
              <label
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-8 text-center transition-colors hover:border-accent focus-within:border-accent"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void readFile(e.dataTransfer.files[0]);
                }}
              >
                <span className="grid h-10 w-10 place-items-center rounded-full border border-line text-fg-muted">
                  <Icon name="upload" className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-fg">Drop a CSV file, or click to choose one</span>
                <span className="text-[12px] text-fg-muted">
                  One contact per row. Up to {MAX_IMPORT_ROWS.toLocaleString("en")} rows. A header row is detected automatically.
                </span>
                <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
              </label>
            ) : (
              <div>
                <label className="block">
                  <span className="text-sm font-medium text-fg">One entry per line, or rows copied from a spreadsheet</span>
                  <textarea
                    rows={7}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    className="acc mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                  />
                </label>
                <Button className="mt-2" size="sm" disabled={!pasted.trim()} onClick={() => load(pasted, null)}>
                  Continue
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-fg-muted">
                <Icon name="table" className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {fileName ?? "Pasted text"} · {table.rows.length.toLocaleString("en")} rows{table.hasHeader ? ", header detected" : ""}
                </span>
              </span>
              <button type="button" onClick={reset} className="font-medium text-fg underline-offset-4 hover:underline">
                Choose another
              </button>
            </div>
            {table.truncated > 0 && (
              <p className="text-[13px] text-warn">
                Only the first {MAX_IMPORT_ROWS.toLocaleString("en")} rows are read; {table.truncated.toLocaleString("en")} more were left out.
              </p>
            )}

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="sr-only">Columns</legend>
              <label className="block">
                <span className="text-sm font-medium text-fg">Match on</span>
                <span className="block text-[12px] text-fg-muted">An email, domain/website or company name column</span>
                <select value={match} onChange={(e) => setMatch(Number(e.target.value))} className={cn(selectClass, "mt-1.5 w-full")}>
                  {table.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                      {sample(i) ? ` (e.g. ${sample(i).slice(0, 40)})` : ""}
                    </option>
                  ))}
                </select>
                {fallbacks.some((c) => c !== match) && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] text-fg-muted">
                    <input type="checkbox" checked={useFallbacks} onChange={(e) => setUseFallbacks(e.target.checked)} className="mt-0.5 accent-accent" />
                    <span>
                      When it&apos;s empty, use {fallbacks.filter((c) => c !== match).map((c) => table.headers[c]).join(", then ")}
                    </span>
                  </label>
                )}
              </label>

              {target === "relationships" && (
                <>
                  <label className="block">
                    <span className="text-sm font-medium text-fg">Type from</span>
                    <span className="block text-[12px] text-fg-muted">A status or stage column, read as Customer, Open deal…</span>
                    <select
                      value={kindColumn ?? ""}
                      onChange={(e) => setKindColumn(e.target.value === "" ? null : Number(e.target.value))}
                      className={cn(selectClass, "mt-1.5 w-full")}
                    >
                      <option value="">No column: use one type for all</option>
                      {table.headers.map((h, i) => (i === match ? null : <option key={i} value={i}>{h}</option>))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-fg">{kindColumn === null ? "Type" : "Type when the column doesn't say"}</span>
                    <select value={defaultKind} onChange={(e) => setDefaultKind(e.target.value as RelationshipKind)} className={cn(selectClass, "mt-1.5 w-full")}>
                      {RELATIONSHIP_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {table.headers.length > 1 && (
                    <div className="sm:col-span-2">
                      <span className="text-sm font-medium text-fg">Note from</span>
                      <span className="block text-[12px] text-fg-muted">Shown when a run matches, e.g. the account owner</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {table.headers.map((h, i) =>
                          i === match || i === kindColumn ? null : (
                            <label key={i} className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] has-[:checked]:border-accent has-[:checked]:text-fg">
                              <input
                                type="checkbox"
                                checked={notes.includes(i)}
                                onChange={(e) => setNotes((n) => (e.target.checked ? [...n, i] : n.filter((x) => x !== i)))}
                                className="accent-accent"
                              />
                              {h}
                            </label>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </fieldset>

            {plan && (
              <section aria-live="polite" className="rounded-xl border border-line">
                <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line-soft px-4 py-3 text-[13px]">
                  <span className="font-semibold text-fg">{added.toLocaleString("en")} new</span>
                  <span className="text-fg-muted">{plan.duplicates.toLocaleString("en")} already in the list</span>
                  <span className={plan.skipped.length ? "text-warn" : "text-fg-muted"}>{plan.skipped.length.toLocaleString("en")} skipped</span>
                  {added > 0 && (
                    <span className="text-fg-muted">
                      {(Object.keys(plan.kinds) as (keyof typeof plan.kinds)[])
                        .filter((k) => plan.kinds[k] > 0)
                        .map((k) => `${plan.kinds[k]} ${ENTRY_KIND_LABEL[k].toLowerCase()}${plan.kinds[k] === 1 ? "" : "s"}`)
                        .join(" · ")}
                    </span>
                  )}
                </div>
                {added > 0 && (
                  <ul className="divide-y divide-line-soft">
                    {(target === "doNotContact" ? plan.doNotContact.map((m) => ({ match: m, kind: undefined, note: "" })) : plan.relationships).slice(0, 6).map((e) => (
                      <li key={e.match} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                        <span className="acc text-fg">{e.match}</span>
                        {e.kind && <span className="text-fg-muted">{relationshipLabel(e.kind)}</span>}
                        {e.note && <span className="min-w-0 truncate text-fg-muted">{e.note}</span>}
                      </li>
                    ))}
                    {added > 6 && <li className="px-4 py-2 text-[12px] text-fg-muted">and {(added - 6).toLocaleString("en")} more</li>}
                  </ul>
                )}
                {plan.skipped.length > 0 && (
                  <div className="border-t border-line-soft px-4 py-2.5">
                    <button type="button" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped} className="text-[13px] font-medium text-fg underline-offset-4 hover:underline">
                      {showSkipped ? "Hide" : "Show"} skipped rows
                    </button>
                    {showSkipped && (
                      <ul className="mt-2 space-y-1 text-[12px] text-fg-muted">
                        {plan.skipped.slice(0, 25).map((s) => (
                          <li key={s.row}>
                            Row {s.row}
                            {s.value ? <span className="acc text-fg"> {s.value}</span> : null}: {s.reason}
                          </li>
                        ))}
                        {plan.skipped.length > 25 && <li>and {plan.skipped.length - 25} more</li>}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
