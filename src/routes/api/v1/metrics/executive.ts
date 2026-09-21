// §5.1 GET /api/v1/metrics/executive
//
// NOTE: uses TanStack Start's server-route API (`createServerFileRoute`, @tanstack/react-start
// 1.168.x). node_modules isn't installed in this scaffold environment, so this hasn't been
// type-checked against the exact installed version — verify the import path against
// @tanstack/react-start's docs for whatever version `bun install` resolves before relying on it.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { analyticsFiltersSchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { getExecutiveMetrics } from "@/server/metrics";

export const ServerRoute = createServerFileRoute("/api/v1/metrics/executive").methods({
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

    const data = getExecutiveMetrics(parsed.data);
    return jsonOk(data, requestId);
  },
});
