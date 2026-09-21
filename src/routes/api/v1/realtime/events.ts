// §7 GET /api/v1/realtime/events — authenticated org-scoped SSE stream. No verbatim text,
// session references, user identifiers, or PHI tags ever cross this channel — events carry
// identifiers/status only, and the client refetches the affected query.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { jsonError, newRequestId } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { store } from "@/server/store";
import type { RealtimeEvent } from "@/server/contracts";

const HEARTBEAT_MS = 15_000;

function toSseChunk(event: { type: string } & Record<string, unknown>, id: string): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const ServerRoute = createServerFileRoute("/api/v1/realtime/events").methods({
  GET: async ({ request }) => {
    const requestId = newRequestId();
    try {
      requireWorkforceSession(request);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    // TODO: scope the subscription to the session's tenantId once multi-tenant events exist —
    // this scaffold's in-memory store is single-tenant.
    let seq = 0;
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: RealtimeEvent) => {
          seq += 1;
          controller.enqueue(encoder.encode(toSseChunk(event, String(seq))));
        };
        unsubscribe = store.subscribe(send);
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), HEARTBEAT_MS);
      },
      cancel() {
        unsubscribe();
        clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "private, no-store",
        connection: "keep-alive",
        "x-request-id": requestId,
      },
    });
  },
});
