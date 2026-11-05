import { z } from "zod";
import { badRequest, handle, json, readJson } from "@/lib/api/http";
import { createRun, getDocument } from "@/lib/db/repo";
import { prospectFromCsvRow } from "@/lib/documents/parse";
import { enqueueRun } from "@/lib/pipeline/runner";
import { validateProspect } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batch runs are capped: each run spends search credits and model requests. */
const MAX_BATCH = 10;

const BatchSchema = z.object({
  documentId: z.string().uuid(),
  rowIndexes: z.array(z.number().int().min(0)).min(1).max(MAX_BATCH),
});

/** Queues one run per selected CSV row. Each run sees only its own row as evidence. */
export const POST = handle(async (request: Request) => {
  const parsed = BatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(`Choose between 1 and ${MAX_BATCH} rows.`);
  const doc = getDocument(parsed.data.documentId);
  if (!doc || doc.scope !== "prospect" || doc.kind !== "csv" || !doc.rows || !doc.csv) return badRequest("That CSV no longer exists. Upload it again.");

  const created: { id: string; rowIndex: number }[] = [];
  const skipped: number[] = [];
  for (const rowIndex of [...new Set(parsed.data.rowIndexes)]) {
    const row = doc.rows[rowIndex];
    if (!row) {
      skipped.push(rowIndex);
      continue;
    }
    const prospect = validateProspect(prospectFromCsvRow(doc.csv.headers, row), { allowEmpty: true });
    if (!prospect.ok) {
      skipped.push(rowIndex);
      continue;
    }
    const run = createRun(prospect.value, [{ documentId: doc.id, name: doc.name, kind: "csv", rowIndex }]);
    enqueueRun(run.id);
    created.push({ id: run.id, rowIndex });
  }
  if (created.length === 0) return badRequest("None of the selected rows could be used.");
  return json({ created, skipped }, 202);
});
