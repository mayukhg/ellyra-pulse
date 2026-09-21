// §5.2 GET /api/v1/metrics/features
import { createServerFileRoute } from "@tanstack/react-start/server";
import { analyticsFiltersSchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { getFeatureMetrics } from "@/server/metrics";

export const ServerRoute = createServerFileRoute("/api/v1/metrics/features").methods({
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

    const data = getFeatureMetrics(parsed.data);
    return jsonOk({ data, meta: { generatedAt: new Date().toISOString(), requestId } }, requestId);
  },
});
