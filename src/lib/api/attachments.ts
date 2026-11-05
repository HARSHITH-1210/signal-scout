import { z } from "zod";
import { getDocument } from "../db/repo";
import type { RunDocument } from "../types";

export const Attachment = z.object({ documentId: z.string().uuid(), rowIndex: z.number().int().min(0).nullable().optional() });

/** Resolves attachments to prospect documents that exist. Returns an error message for anything invalid. */
export function resolveAttachments(input: z.infer<typeof Attachment>[]): { ok: true; documents: RunDocument[] } | { ok: false; error: string } {
  const documents: RunDocument[] = [];
  for (const a of input) {
    const doc = getDocument(a.documentId);
    if (!doc || doc.scope !== "prospect") return { ok: false, error: "An attached file no longer exists. Upload it again." };
    const rowIndex = a.rowIndex ?? null;
    if (doc.kind === "csv" && (rowIndex === null || !doc.rows || rowIndex >= doc.rows.length))
      return { ok: false, error: `Choose which row of ${doc.name} this run is about.` };
    documents.push({ documentId: doc.id, name: doc.name, kind: doc.kind, rowIndex: doc.kind === "csv" ? rowIndex : null });
  }
  return { ok: true, documents };
}


export const AttachmentList = z.array(Attachment).max(5);
