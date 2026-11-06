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
}: {
  scope: DocumentScope;
  onUploaded: (result: UploadResult) => void;
  title: string;
  hint: string;
}) {
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
        className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border-2 border-dashed px-5 py-7 text-center transition-colors ${
          over ? "border-info bg-info-soft" : "border-line bg-surface hover:border-fg-muted/60"
        }`}
      >
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${over ? "bg-info text-white" : "bg-canvas text-obsidian"}`}>
          <Icon name="upload" className="h-5 w-5" />
        </span>
        <span className="font-bold">{busy ?? title}</span>
        <span className="max-w-sm text-sm text-fg-muted">{hint}</span>
        <span className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-obsidian px-4 text-sm font-bold text-obsidian group-hover:bg-canvas">
          Choose file
        </span>
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
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-danger">
        {error}
      </p>
    </div>
  );
}

/** A compact chip for an attached document, with a remove control. */
export function DocumentChip({ doc, detail, onRemove }: { doc: StoredDocument; detail?: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-3 text-sm">
      <Icon name={doc.kind === "csv" ? "table" : "file"} className="h-4 w-4 shrink-0 text-obsidian" />
      <span className="truncate font-bold">{doc.name}</span>
      <span className="acc shrink-0 text-fg-muted">
        {detail ?? (doc.kind === "pdf" ? `${doc.pages ?? "?"} ${doc.pages === 1 ? "page" : "pages"}` : `${doc.csv?.rowCount ?? 0} rows`)}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-canvas hover:text-fg" aria-label={`Remove ${doc.name}`}>
          <Icon name="cross" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}
