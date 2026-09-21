/**
 * Manual API dispatcher for /api/v1/** — NOT TanStack Router file-based routes.
 *
 * The pinned @tanstack/react-start (1.168.32) + @tanstack/react-router (1.170.18) in this
 * project's package.json do not support file-based "server routes" — the router-generator only
 * recognises a file as a route if it exports `Route` (via `createFileRoute`), and there is no
 * `createServerFileRoute`/`ServerRoute` API anywhere in the installed packages. This dispatcher
 * is invoked directly from src/server.ts before any request reaches the TanStack Router SSR
 * handler.
 *
 * Storage is selected via src/backend/repositories/index.ts (Postgres if DATABASE_URL is set,
 * otherwise the in-memory scaffold seeded from data/synthetic/).
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
} from "./contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "./http";
import {
  requireRole,
  requireWorkforceSession,
  verifyIngestionSignature,
  UnauthenticatedError,
  UnauthorisedError,
} from "./auth";
import { runPipelineStages } from "./ingestion/pipeline";
import { ABSA_CLASSIFIER_VERSION } from "./ingestion/absa";
import { pageClinicalOnCall } from "./paging";
import { loadSyntheticFixtures } from "./fixtures";
import { getRepository } from "./repositories";
import { randomUUID } from "node:crypto";

let fixturesLoaded = false;
function ensureFixturesLoaded() {
  if (fixturesLoaded) return;
  fixturesLoaded = true;
  if (getRepository().kind !== "memory") return; // fixtures are for the in-memory scaffold only
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
    if (err instanceof UnauthenticatedError)
      return { response: jsonError(401, "unauthenticated", err.message, requestId) };
    if (err instanceof UnauthorisedError)
      return { response: jsonError(403, "unauthorised", err.message, requestId) };
    throw err;
  }
}

async function handleExecutiveMetrics(
  request: Request,
  requestId: string,
  url: URL,
): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;
  return jsonOk(await getRepository().getExecutiveMetrics(parsed.data), requestId);
}

async function handleFeatureMetrics(
  request: Request,
  requestId: string,
  url: URL,
): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;
  const data = await getRepository().getFeatureMetrics(parsed.data);
  return jsonOk({ data, meta: { generatedAt: new Date().toISOString(), requestId } }, requestId);
}

async function handleQuadrant(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const parsed = parseQuery(url, quadrantQuerySchema, requestId);
  if (!parsed.ok) return parsed.response;
  const data = await getRepository().getQuadrant(
    parsed.data,
    parsed.data.minVolume,
    parsed.data.criticalOnly,
  );
  return jsonOk(
    {
      data,
      thresholds: { highVolume: 300, highAbsoluteImpact: 4 },
      meta: {
        generatedAt: new Date().toISOString(),
        requestId,
        modelVersion: "quadrant-analysis-v1",
      },
    },
    requestId,
  );
}

async function handleAbsa(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const parsed = parseQuery(url, analyticsFiltersSchema, requestId);
  if (!parsed.ok) return parsed.response;
  const data = await getRepository().getAbsaRows(parsed.data);
  return jsonOk(
    {
      data,
      taxonomyVersion: ABSA_CLASSIFIER_VERSION,
      meta: { generatedAt: new Date().toISOString(), requestId },
    },
    requestId,
  );
}

async function handleVerbatims(request: Request, requestId: string, url: URL): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const session = auth.session!;
  const parsed = parseQuery(url, verbatimQuerySchema, requestId);
  if (!parsed.ok) return parsed.response;

  const page = await getRepository().queryVerbatims(parsed.data);
  page.meta.requestId = requestId;
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
  }
  const parsed = simulateWorkflowRequestSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(422, "invalid_body", "Request body failed validation.", requestId, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  const { text, score } = parsed.data;

  const result = runPipelineStages(text, score, score >= 9);
  const response: SimulateWorkflowResponse = {
    simulationId: randomUUID(),
    redactedText: result.redactedText,
    redactions: result.redactions,
    clinicalGate: result.clinicalGate,
    analysis: {
      sentiment: result.sentiment,
      aspects: result.aspects,
      classifierVersion: ABSA_CLASSIFIER_VERSION,
    },
    routing: result.routing,
    stages: result.stages,
  };
  return jsonOk(response, requestId);
}

async function handleIngest(request: Request, requestId: string): Promise<Response> {
  const rawBody = await request.text();

  let credential: { sourceSystem: string };
  try {
    credential = verifyIngestionSignature(request, rawBody);
  } catch (err) {
    if (err instanceof UnauthenticatedError)
      return jsonError(401, "unauthenticated", err.message, requestId);
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
  }
  const parsed = ingestResponseSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(422, "invalid_body", "Request body failed validation.", requestId, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  const body = {
    ...parsed.data,
    sourceSystem: parsed.data.sourceSystem ?? credential.sourceSystem,
  };

  const repository = getRepository();
  const existing = await repository.findExistingIngest(body.sourceSystem, body.externalResponseId);
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

  const shadowMode = (process.env["INGESTION_MODE"] ?? "live") === "shadow";

  if (shadowMode) {
    // Shadow mode (Phase 3 rollout step): run the full pipeline, persist nothing, page no one —
    // for validating production traffic against expected routing before enabling writes.
    const result = runPipelineStages(body.rawText ?? "", body.score, body.score >= 9);
    console.log(
      `[shadow] would route ${body.sourceSystem}/${body.externalResponseId ?? "(no id)"} -> ${result.routing.action}`,
    );
    return jsonOk(
      {
        responseId: randomUUID(),
        processingStatus: "routed",
        statusUrl: null,
        requestId,
        shadow: true,
        wouldRoute: result.routing.action,
      },
      requestId,
      { status: 202 },
    );
  }

  const outcome = await repository.ingestResponse(body, requestId);

  if (outcome.routeAction === "p0_clinical_page") {
    const pageResult = await pageClinicalOnCall({
      responseId: outcome.responseId,
      reasonCodes: outcome.safetyReasonCodes,
      slaSeconds: 15 * 60,
    });
    if (!pageResult.delivered) {
      console.error(
        `[paging] P0 for response ${outcome.responseId} was NOT delivered (${pageResult.transport}: ${pageResult.detail ?? "unknown"})`,
      );
    }
  }

  return jsonOk(
    {
      responseId: outcome.responseId,
      processingStatus: outcome.processingStatus,
      statusUrl: `/api/v1/responses/${outcome.responseId}/status`,
      requestId,
    },
    requestId,
    { status: 202 },
  );
}

async function handleTicketUpdate(
  request: Request,
  requestId: string,
  ticketId: string,
): Promise<Response> {
  const auth = authOrError(request, requestId);
  if (auth.response) return auth.response;
  const session = auth.session!;
  try {
    requireRole(session, ["customer_success", "clinical_safety"]);
  } catch (err) {
    if (err instanceof UnauthorisedError)
      return jsonError(403, "unauthorised", err.message, requestId);
    throw err;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
  }
  const parsed = updateTicketRequestSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(422, "invalid_body", "Request body failed validation.", requestId, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await getRepository().updateTicket(ticketId, {
    status: parsed.data.status,
    version: parsed.data.version,
    resolutionCode: parsed.data.resolutionCode,
    reason: parsed.data.reason,
    actorId: session.userId,
    allowReopenResolved: session.role === "administrator",
  });

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return jsonError(404, "not_found", `Ticket ${ticketId} was not found.`, requestId);
      case "version_conflict":
        return jsonError(
          409,
          "version_conflict",
          "Ticket has been updated since this version was read.",
          requestId,
          { retryable: true },
        );
      case "invalid_transition":
        return jsonError(
          422,
          "invalid_transition",
          `Cannot move ticket from ${result.from} to ${result.to}.`,
          requestId,
        );
      case "reason_required":
        return jsonError(
          400,
          "reason_required",
          "Reopening a resolved ticket requires a reason.",
          requestId,
        );
      case "resolution_code_required":
        return jsonError(
          422,
          "resolution_code_required",
          "P0 tickets require a resolution code to resolve.",
          requestId,
        );
    }
  }
  return jsonOk(result.ticket, requestId);
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
      unsubscribe = getRepository().subscribeRealtime(send);
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

/** Returns a Response if the request matches an /api/v1/** route, or null to fall through to
 * the normal SSR handler. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return null;

  ensureFixturesLoaded();
  const requestId = newRequestId();
  const { pathname } = url;
  const method = request.method.toUpperCase();

  try {
    if (pathname === "/api/v1/metrics/executive" && method === "GET")
      return handleExecutiveMetrics(request, requestId, url);
    if (pathname === "/api/v1/metrics/features" && method === "GET")
      return handleFeatureMetrics(request, requestId, url);
    if (pathname === "/api/v1/analysis/quadrant" && method === "GET")
      return handleQuadrant(request, requestId, url);
    if (pathname === "/api/v1/analysis/absa" && method === "GET")
      return handleAbsa(request, requestId, url);
    if (pathname === "/api/v1/verbatims" && method === "GET")
      return handleVerbatims(request, requestId, url);
    if (pathname === "/api/v1/workflow/simulate" && method === "POST")
      return handleSimulate(request, requestId);
    if (pathname === "/api/v1/responses/ingest" && method === "POST")
      return handleIngest(request, requestId);
    if (pathname === "/api/v1/realtime/events" && method === "GET")
      return handleRealtimeEvents(request, requestId);

    const ticketMatch = pathname.match(TICKET_PATH);
    if (ticketMatch && method === "PATCH")
      return handleTicketUpdate(request, requestId, ticketMatch[1]!);

    return jsonError(404, "not_found", `No route for ${method} ${pathname}.`, requestId);
  } catch (error) {
    console.error(`Unhandled error in ${method} ${pathname}:`, error);
    return jsonError(500, "internal_error", "An unexpected error occurred.", requestId);
  }
}
