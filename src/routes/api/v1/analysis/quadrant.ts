// §5.3 GET /api/v1/analysis/quadrant
import { createServerFileRoute } from "@tanstack/react-start/server";
import { quadrantQuerySchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { getQuadrant } from "@/server/metrics";

const ANALYSIS_MODEL_VERSION = "quadrant-analysis-v1";

export const ServerRoute = createServerFileRoute("/api/v1/analysis/quadrant").methods({
  GET: async ({ request }) => {
    const requestId = newRequestId();
    try {
      requireWorkforceSession(request);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    const parsed = parseQuery(new URL(request.url), quadrantQuerySchema, requestId);
    if (!parsed.ok) return parsed.response;

    const data = getQuadrant(parsed.data, parsed.data.minVolume, parsed.data.criticalOnly);
    return jsonOk(
      {
        data,
        thresholds: { highVolume: 300, highAbsoluteImpact: 4 },
        meta: { generatedAt: new Date().toISOString(), requestId, modelVersion: ANALYSIS_MODEL_VERSION },
      },
      requestId,
    );
  },
});
