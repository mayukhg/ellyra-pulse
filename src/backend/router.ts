/**
 * Manual API dispatcher for /api/v1/** — NOT TanStack Router file-based routes.
 *
 * The pinned @tanstack/react-start (1.168.32) + @tanstack/react-router (1.170.18) in this
 * project's package.json do not support file-based "server routes" — the router-generator only
 * recognises a file as a route if it exports `Route` (via `createFileRoute`), and there is no
 * `createServerFileRoute`/`ServerRoute` API anywhere in the installed packages. An earlier
 * version of this scaffold wrote routes under src/routes/api/** using that nonexistent API;
 * they were silently excluded from the route tree (confirmed by running `bun run dev` and
 * seeing "does not export a Route" warnings for every one of them).
 *
 * Given that, this dispatcher is invoked directly from src/server.ts — the app's actual fetch
 * entry point — before any request reaches the TanStack Router SSR handler. Every endpoint from
 * docs/DESIGN_UI.md §5 is implemented here as a plain (Request) => Promise<Response> function,
 * reusing the same business logic (src/backend/{metrics,verbatims,ingestion,store}.ts)
 * unchanged.
 */
import {
  analyticsFiltersSchema,
  ingestResponseSchema,
  quadrantQuerySchema,
  simulateWorkflowRequestSchema,
  updateTicketRequestSchema,
  verbatimQuerySchema,
  type RealtimeEvent,
  type SimulateWorkflowResponse,
  type TicketStatus,
} from "./contracts";
import { jsonError, jsonOk, newRequestId, parseBody, parseQuery } from "./http";
import {
  requireIngestionCredential,
  requireRole,
  requireWorkforceSession,
  UnauthenticatedError,
  UnauthorisedError,
} from "./auth";
import { getAbsaRows, getExecutiveMetrics, getFeatureMetrics, getQuadrant } from "./metrics";
import { queryVerbatims } from "./verbatims";
import { runPipelineStages, ingest } from "./ingestion/pipeline";
import { ABSA_CLASSIFIER_VERSION } from "./ingestion/absa";
import { store } from "./store";
import { randomUUID } from "node:crypto";
import { loadSyntheticFixtures } from "./fixtures";

// Load the demo dataset once, on first request into the API surface. See
// data/synthetic/README.md — not for production use.
let fixturesLoaded = false;
function ensureFixturesLoaded() {
  if (fixturesLoaded) return;
  fixturesLoaded = true;
  try {
    loadSyntheticFixtures();
  } catch (err) {
    console.error("Failed to load synthetic fixtures:", err);
  }
}

function authOrError(request: Request, requestId: string) {
  try {
    return { session: requireWorkforceSession(request) };
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return { response: jsonError(401, "unauthenticated", err.message, requestId) };
    }
    if (err instanceof UnauthorisedError) {
      return { response: jsonError(403, "unauthorised", err.message, requestId) };
    }
    throw err;
  }
}

async function handleExecutiveMetrics(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;

  return jsonOk(getExecutiveMetrics(parsed.data), requestId);
}

async function handleFeatureMetrics(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;

  const data = getFeatureMetrics(parsed.data);
  return jsonOk({ data, meta: { generatedAt: new Date().toISOString(), requestId } }, requestId);
}

async function handleQuadrant(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

  const parsed = parseQuery(url, quadrantQuerySchema, requestId);
  if (!parsed.ok) return parsed.response;

  const data = getQuadrant(parsed.data, parsed.data.minVolume, parsed.data.criticalOnly);
  return jsonOk(
    {
      data,
      thresholds: { highVolume: 300, highAbsoluteImpact: 4 },
      meta: { generatedAt: new Date().toISOString(), requestId, modelVersion: "quadrant-analysis-v1" },
    },
    requestId,
  );
}

async function handleAbsa(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;

  const data = getAbsaRows(parsed.data);
  return jsonOk(
    { data, taxonomyVersion: ABSA_CLASSIFIER_VERSION, meta: { generatedAt: new Date().toISOString(), requestId } },
    requestId,
  );
}

async function handleVerbatims(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const session = auth.session!;

  const parsed = parseQuery(url, verbatimQuerySchema, requestId);
  if (!parsed.ok) return parsed.response;

  const page = queryVerbatims(parsed.data);
  if (session.role !== "clinical_safety" && session.role !== "administrator") {
    page.data = page.data.map((item) => ({
      ...item,
      safety: { flagged: item.safety.flagged, reasonCodes: [] },
      telemetry: { ...item.telemetry, sessionRef: null },
    }));
  }
  return jsonOk(page, requestId);
}

async function handleSimulate(request: Request, requestId: string): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

  const parsed = await parseBody(request, simulateWorkflowRequestSchema, requestId);
  if (!parsed.ok) return parsed.response;
  const { text, score } = parsed.data;

  const result = runPipelineStages(text, score, score >= 9);
  const response: SimulateWorkflowResponse = {
    simulationId: randomUUID(),
    redactedText: result.redactedText,
    redactions: result.redactions,
    clinicalGate: result.clinicalGate,
    analysis: { sentiment: result.sentiment, aspects: result.aspects, classifierVersion: ABSA_CLASSIFIER_VERSION },
    routing: result.routing,
    stages: result.stages,
  };
  return jsonOk(response, requestId);
}

async function handleIngest(request: Request, requestId: string): Promise<Response> {
  let credential;
  try {
    credential = requireIngestionCredential(request);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
    throw err;
  }

  const parsed = await parseBody(request, ingestResponseSchema, requestId);
  if (!parsed.ok) return parsed.response;
  const body = { ...parsed.data, sourceSystem: parsed.data.sourceSystem ?? credential.sourceSystem };

  const existing = store.findByExternalId(body.sourceSystem, body.externalResponseId);
  if (existing) {
    return jsonOk(
      {
        responseId: existing.responseId,
        processingStatus: existing.processingStatus,
        statusUrl: `/api/v1/responses/${existing.responseId}/status`,
        requestId,
      },
      requestId,
      { status: 202 },
    );
  }

  const result = ingest(body, requestId);
  return jsonOk(
    {
      responseId: result.responseId,
      processingStatus: result.processingStatus,
      statusUrl: `/api/v1/responses/${result.responseId}/status`,
      requestId,
    },
    requestId,
    { status: 202 },
  );
}

const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["contacted", "escalated"],
  contacted: ["resolved", "escalated"],
  escalated: ["contacted", "resolved"],
  resolved: [],
};

async function handleTicketUpdate(request: Request, requestId: string, ticketId: string): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const session = auth.session!;
  try {
    requireRole(session, ["customer_success", "clinical_safety"]);
  } catch (err) {
    if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
    throw err;
  }

  const parsed = await parseBody(request, updateTicketRequestSchema, requestId);
  if (!parsed.ok) return parsed.response;
  const { status: newStatus, version, resolutionCode, reason } = parsed.data;

  const ticket = store.ticketById(ticketId);
  if (!ticket) return jsonError(404, "not_found", `Ticket ${ticketId} was not found.`, requestId);
  if (ticket.version !== version) {
    return jsonError(409, "version_conflict", "Ticket has been updated since this version was read.", requestId, {
      retryable: true,
    });
  }

  const reopeningResolved = ticket.status === "resolved" && newStatus !== "resolved";
  const allowed = ALLOWED_TRANSITIONS[ticket.status].includes(newStatus);
  if (!allowed && !(reopeningResolved && session.role === "administrator")) {
    return jsonError(422, "invalid_transition", `Cannot move ticket from ${ticket.status} to ${newStatus}.`, requestId);
  }
  if (reopeningResolved && !reason) {
    return jsonError(400, "reason_required", "Reopening a resolved ticket requires a reason.", requestId);
  }
  if (ticket.ticketType === "p0_clinical" && newStatus === "resolved" && !resolutionCode) {
    return jsonError(422, "resolution_code_required", "P0 tickets require a resolution code to resolve.", requestId);
  }

  const oldStatus = ticket.status;
  ticket.status = newStatus;
  ticket.version += 1;
  ticket.updatedAt = new Date().toISOString();
  if (newStatus === "contacted" && !ticket.firstContactAt) ticket.firstContactAt = ticket.updatedAt;
  if (newStatus === "resolved") ticket.resolvedAt = ticket.updatedAt;
  if (resolutionCode) ticket.resolutionCode = resolutionCode;
  ticket.lastUpdatedBy = session.userId;

  store.appendAudit({
    responseId: ticket.responseId,
    stage: "routing",
    status: "completed",
    detailCodes: [`ticket_status:${oldStatus}->${newStatus}`],
    requestId,
  });
  store.publish({ type: "ticket.updated", id: ticket.ticketId, occurredAt: ticket.updatedAt, status: ticket.status, version: ticket.version });

  return jsonOk(ticket, requestId);
}

function toSseChunk(event: { type: string } & Record<string, unknown>, id: string): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function handleRealtimeEvents(request: Request, requestId: string): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;

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
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
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
}

const TICKET_PATH = /^\/api\/v1\/tickets\/([^/]+)$/;

/**
 * Returns a Response if the request matches an /api/v1/** route, or null to let the caller
 * (src/server.ts) fall through to the normal SSR handler.
 */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return null;

  ensureFixturesLoaded();
  const requestId = newRequestId();
  const { pathname } = url;
  const method = request.method.toUpperCase();

  try {
    if (pathname === "/api/v1/metrics/executive" && method === "GET") return handleExecutiveMetrics(request, requestId, url);
    if (pathname === "/api/v1/metrics/features" && method === "GET") return handleFeatureMetrics(request, requestId, url);
    if (pathname === "/api/v1/analysis/quadrant" && method === "GET") return handleQuadrant(request, requestId, url);
    if (pathname === "/api/v1/analysis/absa" && method === "GET") return handleAbsa(request, requestId, url);
    if (pathname === "/api/v1/verbatims" && method === "GET") return handleVerbatims(request, requestId, url);
    if (pathname === "/api/v1/workflow/simulate" && method === "POST") return handleSimulate(request, requestId);
    if (pathname === "/api/v1/responses/ingest" && method === "POST") return handleIngest(request, requestId);
    if (pathname === "/api/v1/realtime/events" && method === "GET") return handleRealtimeEvents(request, requestId);

    const ticketMatch = pathname.match(TICKET_PATH);
    if (ticketMatch && method === "PATCH") return handleTicketUpdate(request, requestId, ticketMatch[1]);

    return jsonError(404, "not_found", `No route for ${method} ${pathname}.`, requestId);
  } catch (error) {
    console.error(`Unhandled error in ${method} ${pathname}:`, error);
    return jsonError(500, "internal_error", "An unexpected error occurred.", requestId);
  }
}
