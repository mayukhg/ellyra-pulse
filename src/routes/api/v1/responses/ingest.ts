// §5.7 POST /api/v1/responses/ingest — production machine-to-machine ingestion.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { ingestResponseSchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseBody } from "@/server/http";
import { requireIngestionCredential, UnauthenticatedError } from "@/server/auth";
import { store } from "@/server/store";
import { ingest } from "@/server/ingestion/pipeline";

export const ServerRoute = createServerFileRoute("/api/v1/responses/ingest").methods({
  POST: async ({ request }) => {
    const requestId = newRequestId();
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

    // Idempotency: replaying the same (sourceSystem, externalResponseId) pair returns the
    // existing record instead of creating a duplicate.
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
  },
});
