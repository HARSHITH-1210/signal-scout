import { badRequest, handle, json } from "@/lib/api/http";
import { createDocument, listDocuments, toStoredDocument } from "@/lib/db/repo";
import { DocumentError, MAX_UPLOAD_BYTES, parseDocument, prospectFromCsvRow } from "@/lib/documents/parse";
import type { DocumentScope } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: DocumentScope[] = ["prospect", "sender"];
const MAX_PREVIEW_ROWS = 500;

export const GET = handle(async (request: Request) => {
  const scope = new URL(request.url).searchParams.get("scope") as DocumentScope | null;
  if (!scope || !SCOPES.includes(scope)) return badRequest("Unknown document scope.");
  return json({ documents: listDocuments(scope).map(toStoredDocument) });
});

/**
 * Uploads one PDF or CSV (multipart field "file", plus "scope"). The text is extracted and stored on the
 * server; the browser gets metadata, and for a prospect CSV, each row mapped onto prospect fields.
 */
export const POST = handle(async (request: Request) => {
  if (!/^multipart\/form-data\b/i.test(request.headers.get("content-type") ?? "")) return badRequest("Upload a file as multipart/form-data.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "Files must be 10 MB or smaller." }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("The upload couldn't be read.");
  }
  const file = form.get("file");
  const scope = form.get("scope") as DocumentScope | null;
  if (!(file instanceof File)) return badRequest("Choose a file to upload.");
  if (!scope || !SCOPES.includes(scope)) return badRequest("Unknown document scope.");
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Files must be 10 MB or smaller." }, 413);

  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "document";
  try {
    const parsed = await parseDocument(name, new Uint8Array(await file.arrayBuffer()));
    const doc = createDocument({ scope, name, kind: parsed.kind, text: parsed.text, meta: { pages: parsed.pages, csv: parsed.csv } });
    const rows =
      scope === "prospect" && parsed.csv
        ? parsed.csv.rows.slice(0, MAX_PREVIEW_ROWS).map((row, index) => ({ index, prospect: prospectFromCsvRow(parsed.csv!.headers, row), cells: row }))
        : null;
    return json({ document: toStoredDocument(doc), headers: parsed.csv?.headers ?? null, rows }, 201);
  } catch (error) {
    if (error instanceof DocumentError) return json({ error: error.message }, 422);
    throw error;
  }
});
