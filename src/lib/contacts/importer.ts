// Importing contact-list entries from a CSV file (a CRM export, an unsubscribe list) or pasted text.
// Pure and browser-safe: the file is read in the browser and never uploaded; only the resulting
// entries are saved, after the rep confirms the preview.
import Papa from "papaparse";
import type { RelationshipEntry, RelationshipKind } from "../types";
import { entryKey, MAX_ENTRIES_PER_LIST, MAX_NOTE_LENGTH, normaliseEntry, type EntryKind } from "./rules";

export const MAX_IMPORT_ROWS = MAX_ENTRIES_PER_LIST;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface Table {
  headers: string[];
  rows: string[][];
  /** False when the first line was data (e.g. a pasted column of emails), so headers are generated. */
  hasHeader: boolean;
  /** Rows dropped because the table was longer than MAX_IMPORT_ROWS. */
  truncated: number;
}

const looksLikeData = (cell: string) => {
  const c = cell.trim();
  return c.includes("@") || /^https?:\/\//i.test(c) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c);
};

/** Parses CSV/TSV text (delimiter detected) into a table. A first row of emails or domains is data, not headers. */
export function parseTable(text: string): Table {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const raw = result.data.map((row) => row.map((cell) => String(cell ?? "").trim())).filter((row) => row.some(Boolean));
  if (raw.length === 0) return { headers: [], rows: [], hasHeader: false, truncated: 0 };
  const width = Math.max(...raw.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
  const hasHeader = !raw[0].some(looksLikeData) && raw.length > 1;
  const headers = hasHeader ? pad(raw[0]).map((h, i) => h || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => (width === 1 ? "Entry" : `Column ${i + 1}`));
  const body = (hasHeader ? raw.slice(1) : raw).map(pad);
  return { headers, rows: body.slice(0, MAX_IMPORT_ROWS), hasHeader, truncated: Math.max(0, body.length - MAX_IMPORT_ROWS) };
}

const HEADER_HINTS: { field: "email" | "domain" | "company" | "kind" | "note"; pattern: RegExp }[] = [
  { field: "email", pattern: /^(e-?mail|work[ _-]?e-?mail|e-?mail[ _-]?address|contact[ _-]?e-?mail)$/i },
  { field: "domain", pattern: /^(domain|website|web[ _-]?site|company[ _-]?(domain|website|url)|url|site)$/i },
  { field: "company", pattern: /^(company|company[ _-]?name|account|account[ _-]?name|organi[sz]ation|business|customer|client)$/i },
  { field: "kind", pattern: /^(status|stage|deal[ _-]?stage|lifecycle[ _-]?stage|type|relationship|account[ _-]?type)$/i },
  { field: "note", pattern: /^(note|notes|comment|comments|owner|account[ _-]?owner|deal[ _-]?owner|reason|details)$/i },
];

export interface ColumnGuess {
  /** Column whose values become the entries. */
  match: number;
  /** Column read as the relationship type (Customer, Open deal…), if any. */
  kind: number | null;
  /** Columns joined into the note. */
  notes: number[];
  /** Other identifier columns (email, domain, company order), used when a row's match cell is empty. */
  fallbacks: number[];
}

/**
 * Picks the likely columns. For matching, an email column wins (most precise), then a domain or
 * website, then a company name; failing headers, the column whose values look most like emails or domains.
 */
export function guessColumns(table: Table): ColumnGuess {
  const fieldOf = (h: string) => HEADER_HINTS.find((hint) => hint.pattern.test(h.trim()))?.field;
  const fields = table.headers.map(fieldOf);
  const first = (f: string) => fields.indexOf(f as never);
  const identifiers = [first("email"), first("domain"), first("company")].filter((i) => i >= 0);
  let match = identifiers[0] ?? -1;
  if (match < 0) {
    const sample = table.rows.slice(0, 50);
    const score = table.headers.map((_, c) => sample.filter((r) => looksLikeData(r[c] ?? "")).length);
    const best = Math.max(0, ...score);
    match = best > 0 ? score.indexOf(best) : 0;
  }
  const kind = first("kind");
  const notes = fields.flatMap((f, i) => (f === "note" && i !== match ? [i] : []));
  return { match, kind: kind >= 0 && kind !== match ? kind : null, notes, fallbacks: identifiers.filter((i) => i !== match) };
}

/** Reads a CRM status or stage as a relationship type; null when it doesn't say. */
export function kindFromStatus(value: string): RelationshipKind | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/partner|reseller|alliance/.test(v)) return "partner";
  if (/churn|former|lost|cancel|inactive|past|ex-?customer|closed[ _-]?lost/.test(v)) return "past_contact";
  if (/customer|client|closed[ _-]?won|\bwon\b|active|subscriber|paying/.test(v)) return "customer";
  if (/open|opportunit|deal|negotiat|proposal|pipeline|prospect|qualif|demo|trial|evaluat|lead/.test(v)) return "open_deal";
  return null;
}

export interface ImportOptions {
  target: "doNotContact" | "relationships";
  match: number;
  kindColumn: number | null;
  /** Used when the row has no readable type (or there is no type column). */
  defaultKind: RelationshipKind;
  notes: number[];
  /** Tried in order when the match cell is empty. */
  fallbacks?: number[];
}

export interface SkippedRow {
  /** 1-based row number as the rep sees it in the file (header counted). */
  row: number;
  value: string;
  reason: string;
}

export interface ImportPlan {
  doNotContact: string[];
  relationships: RelationshipEntry[];
  /** Entries already in the list, or repeated within the file. */
  duplicates: number;
  skipped: SkippedRow[];
  kinds: Record<EntryKind, number>;
}

/** Turns table rows into new entries for one list, skipping blanks, invalid values and duplicates. */
export function planImport(table: Table, options: ImportOptions, existing: string[]): ImportPlan {
  const seen = new Set(existing.map(entryKey));
  const plan: ImportPlan = { doNotContact: [], relationships: [], duplicates: 0, skipped: [], kinds: { email: 0, domain: 0, company: 0 } };
  table.rows.forEach((row, i) => {
    const rowNumber = i + (table.hasHeader ? 2 : 1);
    const column = [options.match, ...(options.fallbacks ?? [])].find((c) => (row[c] ?? "").trim()) ?? options.match;
    const raw = row[column] ?? "";
    if (!raw.trim()) return plan.skipped.push({ row: rowNumber, value: "", reason: "Empty" });
    const n = normaliseEntry(raw);
    if (!n.ok) return plan.skipped.push({ row: rowNumber, value: raw.slice(0, 80), reason: n.reason });
    if (seen.has(entryKey(n.value))) {
      plan.duplicates++;
      return;
    }
    seen.add(entryKey(n.value));
    plan.kinds[n.kind]++;
    if (options.target === "doNotContact") {
      plan.doNotContact.push(n.value);
      return;
    }
    const kind = (options.kindColumn !== null ? kindFromStatus(row[options.kindColumn] ?? "") : null) ?? options.defaultKind;
    const note = options.notes
      .map((c) => {
        const cell = (row[c] ?? "").replace(/\s+/g, " ").trim();
        // A note column like "Owner" reads better with its header: "Owner: Sam".
        const plainNote = /^(note|notes|comment|comments|details)$/i.test(table.headers[c] ?? "");
        return cell && table.hasHeader && !plainNote ? `${table.headers[c]}: ${cell}` : cell;
      })
      .filter(Boolean)
      .join(" · ")
      .slice(0, MAX_NOTE_LENGTH);
    plan.relationships.push({ match: n.value, kind, note });
  });
  return plan;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

/**
 * CSV export of one list. Cells that a spreadsheet would run as a formula (=, +, -, @) are prefixed
 * with an apostrophe, so an exported list can't execute anything when opened.
 */
export function toCsv(target: "doNotContact" | "relationships", entries: string[] | RelationshipEntry[]): string {
  if (target === "doNotContact") return ["entry", ...(entries as string[]).map(csvCell)].join("\r\n");
  return [
    "entry,type,note",
    ...(entries as RelationshipEntry[]).map((e) => [e.match, e.kind ?? "", e.note].map(csvCell).join(",")),
  ].join("\r\n");
}
