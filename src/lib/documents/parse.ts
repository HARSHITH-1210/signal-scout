import Papa from "papaparse";
import type { DocumentKind, ProspectInput } from "../types";
import { sanitizeText } from "../pipeline/sanitize";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 200_000;
export const MAX_PDF_PAGES = 60;
export const MAX_CSV_ROWS = 500;
export const MAX_CSV_COLUMNS = 60;
const MAX_CELL_CHARS = 2_000;

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

export interface ParsedDocument {
  kind: DocumentKind;
  text: string;
  pages: number | null;
  csv: { headers: string[]; rows: string[][] } | null;
}

/** Detects the file type from its bytes and name; the browser's MIME type is only a hint. */
export function detectKind(name: string, bytes: Uint8Array): DocumentKind {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (head === "%PDF-") return "pdf";
  if (/\.(csv|tsv|txt)$/i.test(name)) return "csv";
  throw new DocumentError("Only PDF and CSV files are supported.");
}

/** Extracts text from a PDF. Scanned PDFs (images only) have no text and are refused with a clear message. */
async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new DocumentError("This PDF couldn't be opened. It may be damaged or password-protected.");
  }
  if (pdf.numPages > MAX_PDF_PAGES) throw new DocumentError(`This PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
  const { text } = await extractText(pdf, { mergePages: true });
  const clean = sanitizeText(text, MAX_DOCUMENT_CHARS);
  if (clean.replace(/\s/g, "").length < 40)
    throw new DocumentError("This PDF has no selectable text (it may be a scan). Export it with text, or paste the details into the form.");
  return { kind: "pdf", text: clean, pages: pdf.numPages, csv: null };
}

/** Parses a CSV (or TSV) with a header row. Each row becomes "Header: value" lines when used as evidence. */
export function parseCsv(raw: string): ParsedDocument {
  const text = raw.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: "" });
  const rows = (result.data as unknown[]).filter((r): r is string[] => Array.isArray(r));
  if (rows.length < 2) throw new DocumentError("This CSV needs a header row and at least one data row.");
  const headers = rows[0].map((h, i) => sanitizeText(String(h), 80) || `Column ${i + 1}`).slice(0, MAX_CSV_COLUMNS);
  const body = rows
    .slice(1, MAX_CSV_ROWS + 1)
    .map((r) => headers.map((_, i) => sanitizeText(String(r[i] ?? ""), MAX_CELL_CHARS)))
    .filter((r) => r.some((cell) => cell.length > 0));
  if (body.length === 0) throw new DocumentError("This CSV has no data rows.");
  const preview = body.map((r) => csvRowText(headers, r)).join("\n\n");
  return { kind: "csv", text: sanitizeText(preview, MAX_DOCUMENT_CHARS), pages: null, csv: { headers, rows: body } };
}

export async function parseDocument(name: string, bytes: Uint8Array): Promise<ParsedDocument> {
  if (bytes.byteLength === 0) throw new DocumentError("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new DocumentError("Files must be 10 MB or smaller.");
  const kind = detectKind(name, bytes);
  if (kind === "pdf") return parsePdf(bytes);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (decoded.includes("\u0000")) throw new DocumentError("This doesn't look like a text CSV file.");
  return parseCsv(decoded);
}

/** One CSV row as evidence text: only this prospect's row, never the whole sheet (other rows are other people). */
export function csvRowText(headers: string[], row: string[]): string {
  return headers
    .map((h, i) => (row[i] ? `${h}: ${row[i]}` : ""))
    .filter(Boolean)
    .join("\n");
}

const HEADER_RULES: { field: keyof ProspectInput | "firstName" | "lastName" | "email"; pattern: RegExp }[] = [
  { field: "firstName", pattern: /^(first|given)[ _-]?name$/i },
  { field: "lastName", pattern: /^(last|family|sur)[ _-]?name$|^surname$/i },
  { field: "name", pattern: /^(full[ _-]?name|name|contact|contact[ _-]?name|prospect|person|lead[ _-]?name)$/i },
  { field: "company", pattern: /^(company|company[ _-]?name|account|account[ _-]?name|organi[sz]ation|employer|business)$/i },
  { field: "role", pattern: /^(title|job[ _-]?title|role|position|designation|seniority)$/i },
  { field: "companyWebsite", pattern: /^(website|company[ _-]?website|domain|company[ _-]?domain|url|web|site)$/i },
  { field: "linkedinUrl", pattern: /linkedin/i },
  { field: "email", pattern: /^(e-?mail|work[ _-]?email|email[ _-]?address)$/i },
  { field: "notes", pattern: /^(notes?|description|comments?|context|about)$/i },
];

const FREE_MAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton(mail)?|gmx|zoho)\./i;

/** Maps a CSV row onto prospect fields using its headers. Unmapped columns stay in the row's evidence text. */
export function prospectFromCsvRow(headers: string[], row: string[]): ProspectInput {
  const found: Partial<Record<string, string>> = {};
  headers.forEach((header, i) => {
    const value = row[i]?.trim();
    if (!value) return;
    const rule = HEADER_RULES.find((r) => r.pattern.test(header.trim()));
    if (rule && !found[rule.field]) found[rule.field] = value;
  });
  const name = found.name ?? ([found.firstName, found.lastName].filter(Boolean).join(" ") || undefined);
  // A work email's domain is a strong company identifier; free-mail domains are not.
  const emailDomain = found.email && !FREE_MAIL.test(found.email) ? found.email.split("@")[1] : undefined;
  const out: ProspectInput = {
    name,
    email: found.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(found.email) ? found.email : undefined,
    company: found.company,
    role: found.role,
    companyWebsite: found.companyWebsite ?? emailDomain,
    linkedinUrl: found.linkedinUrl && /linkedin\.com\/in\//i.test(found.linkedinUrl) ? found.linkedinUrl : undefined,
    notes: found.notes?.slice(0, 500),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as ProspectInput;
}

/** Splits long text into overlapping chunks so each fits a source slot and quotes can still be verified. */
export function chunkText(text: string, size = 3200, overlap = 200): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const breakAt = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end));
      if (breakAt > start + size * 0.6) end = breakAt + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

/** Picks the chunks of a long document most relevant to some query words, for prompts with limited room. */
export function relevantChunks(text: string, query: string, limit = 3, size = 1400): string[] {
  const chunks = chunkText(text, size, 100);
  if (chunks.length <= limit) return chunks;
  const terms = new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3));
  const scored = chunks.map((chunk, i) => {
    const words = chunk.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    const score = words.reduce((n, w) => n + (terms.has(w) ? 1 : 0), 0);
    return { chunk, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((s) => s.chunk);
}
