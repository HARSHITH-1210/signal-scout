import { notFound } from "@/lib/api/http";
import { logError } from "@/lib/config";
import { getRun, listEvents } from "@/lib/db/repo";
import { TERMINAL_STATUSES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 600;
const MAX_STREAM_MS = 10 * 60_000;

/**
 * Server-sent events for the live run view. Replays every persisted event (so a refresh never loses
 * state), then tails the database until the run reaches a terminal status.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getRun(id)) return notFound();

  const lastEventHeader = Number(request.headers.get("last-event-id") ?? 0);
  let cursor = Number.isFinite(lastEventHeader) ? lastEventHeader : 0;
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, eventId?: number) => {
        const idLine = eventId !== undefined ? `id: ${eventId}\n` : "";
        controller.enqueue(encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let lastStatus = "";
      let closed = false;
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      while (!closed && Date.now() - startedAt < MAX_STREAM_MS) {
        let run;
        try {
          run = getRun(id);
        } catch (error) {
          logError(`events stream ${id}`, error);
          send("error", { error: "Live updates were interrupted. Refresh to reconnect." });
          break;
        }
        if (!run) break;
        for (const event of listEvents(id, cursor)) {
          send("stage", event, event.id);
          cursor = event.id;
        }
        if (run.status !== lastStatus) {
          lastStatus = run.status;
          send("status", { status: run.status, error: run.error, updatedAt: run.updatedAt });
        }
        if (TERMINAL_STATUSES.includes(run.status)) {
          send("done", { status: run.status });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      try {
        controller.close();
      } catch {
        // already closed by the client
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
