import { handle, json, notFound } from "@/lib/api/http";
import { deleteDocument } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Removes an uploaded file. Runs that already used it keep their captured evidence. */
export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return deleteDocument(id) ? json({ deleted: true }) : notFound("Document");
});
