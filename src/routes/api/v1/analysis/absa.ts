// §5.4 GET /api/v1/analysis/absa
import { createServerFileRoute } from "@tanstack/react-start/server";
import { analyticsFiltersSchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { getAbsaRows } from "@/server/metrics";
import { ABSA_CLASSIFIER_VERSION } from "@/server/ingestion/absa";

export const ServerRoute = createServerFileRoute("/api/v1/analysis/absa").methods({
  GET: async ({ request }) => {
    const requestId = newRequestId();
    try {
      requireWorkforceSession(request);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    const parsed = parseQuery(new URL(request.url), analyticsFiltersSchema, requestId);
    if (!parsed.ok) return parsed.response;

    const data = getAbsaRows(parsed.data);
    return jsonOk(
      { data, taxonomyVersion: ABSA_CLASSIFIER_VERSION, meta: { generatedAt: new Date().toISOString(), requestId } },
      requestId,
    );
  },
});
