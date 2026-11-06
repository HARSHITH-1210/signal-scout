"use client";

import { useRef, useState, type DragEvent } from "react";
import type { DocumentScope, ProspectInput, StoredDocument } from "@/lib/types";
import { Icon } from "./Icon";

export interface UploadResult {
  document: StoredDocument;
  headers: string[] | null;
  rows: { index: number; prospect: ProspectInput; cells: string[] }[] | null;
}

/**
 * Drop a PDF or CSV here, or choose one. Dragging is never the only way in: the whole zone is a
 * labelled file input, so it works by click, keyboard and screen reader too.
 */
export function DropZone({
  scope,
  onUploaded,
  title,
  hint,
  variant = "default",
}: {
  scope: DocumentScope;
  onUploaded: (result: UploadResult) => void;
  title: string;
  hint: string;
  variant?: "default" | "telemetry";
}) {
  const t = variant === "telemetry";
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []).slice(0, 5);
    if (list.length === 0) return;
    setError(null);
    for (const file of list) {
      setBusy(`Reading ${file.name}…`);
      const form = new FormData();
      form.set("file", file);
      form.set("scope", scope);
      try {
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(`${file.name}: ${data.error ?? `upload failed (HTTP ${res.status}).`}`);
          continue;
        }
        onUploaded(data as UploadResult);
      } catch {
        setError("Couldn't reach the server. Check that it's running and try again.");
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void upload(event.dataTransfer.files);
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={
          t
            ? `group relative flex cursor-pointer flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-dashed px-5 py-5 transition-[border-color,background-color] duration-200 ${
                over ? "border-[var(--t-info)] bg-[var(--t-pill-hover)]" : "border-[var(--t-line)] hover:border-[var(--t-muted)]"
              }`
            : `group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-5 py-8 text-center transition-[border-color,background-color,transform] duration-200 ${
                over ? "scale-[1.01] border-accent bg-accent-soft" : "border-line bg-subtle/40 hover:border-fg-muted/50 hover:bg-subtle/70"
              }`
        }
      >
        {t ? (
          <>
            {over && <span aria-hidden className="t-volt-bg absolute inset-x-0 top-0 h-[2px]" />}
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--t-line)] text-[var(--t-muted)] transition-transform duration-200 group-hover:-translate-y-0.5">
              <Icon name="upload" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{busy ?? title}</span>
              <span className="t-mono mt-0.5 block text-[11px] text-[var(--t-muted)]">{hint}</span>
            </span>
            <span className="t-mono inline-flex min-h-9 items-center rounded-full border border-[var(--t-line)] px-3.5 text-[11px] uppercase tracking-[0.1em] text-[var(--t-fg)] group-hover:border-[var(--t-muted)]">
              Choose file
            </span>
          </>
        ) : (
          <>
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${over ? "bg-obsidian-gradient" : "border border-line bg-surface text-fg-soft shadow-sm"} transition-transform duration-200 group-hover:-translate-y-0.5`}>
              <Icon name="upload" className="h-5 w-5" />
            </span>
            <span className="font-medium">{busy ?? title}</span>
            <span className="max-w-sm text-sm text-fg-muted">{hint}</span>
            <span className="mt-1 inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-fg shadow-sm group-hover:border-fg-muted/40">
              Choose file
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,.csv,.tsv,application/pdf,text/csv"
          multiple
          className="sr-only"
          disabled={busy !== null}
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
      <p role="status" aria-live="polite" className={t ? "t-mono mt-2 min-h-4 text-[11px] text-[var(--t-bad)]" : "mt-2 min-h-5 text-sm text-danger"}>
        {error}
      </p>
    </div>
  );
}

/** A compact chip for an attached document, with a remove control. */
export function DocumentChip({ doc, detail, onRemove, variant = "default" }: { doc: StoredDocument; detail?: string; onRemove?: () => void; variant?: "default" | "telemetry" }) {
  return (
    <span
      className={
        variant === "telemetry"
          ? "inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--t-line)] bg-[var(--t-card)] py-1 pr-1 pl-3.5 text-[13px] [&_.acc]:text-[var(--t-muted)]"
          : "inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-3 text-sm"
      }
    >
      <Icon name={doc.kind === "csv" ? "table" : "file"} className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="truncate font-medium">{doc.name}</span>
      <span className="acc shrink-0 text-fg-muted">
        {detail ?? (doc.kind === "pdf" ? `${doc.pages ?? "?"} ${doc.pages === 1 ? "page" : "pages"}` : `${doc.csv?.rowCount ?? 0} rows`)}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg" aria-label={`Remove ${doc.name}`}>
          <Icon name="cross" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}
