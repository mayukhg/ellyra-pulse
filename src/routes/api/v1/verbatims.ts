// §5.5 GET /api/v1/verbatims — cursor-paginated, redacted-text-only search.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { verbatimQuerySchema } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseQuery } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { queryVerbatims } from "@/server/verbatims";

export const ServerRoute = createServerFileRoute("/api/v1/verbatims").methods({
  GET: async ({ request }) => {
    const requestId = newRequestId();
    let session;
    try {
      session = requireWorkforceSession(request);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    const parsed = parseQuery(new URL(request.url), verbatimQuerySchema, requestId);
    if (!parsed.ok) return parsed.response;

    const page = queryVerbatims(parsed.data);

    // Users without clinical-safety permission get a minimised safety payload and pseudonymised
    // telemetry, per §5.5.
    if (session.role !== "clinical_safety" && session.role !== "administrator") {
      page.data = page.data.map((item) => ({
        ...item,
        safety: { flagged: item.safety.flagged, reasonCodes: [] },
        telemetry: { ...item.telemetry, sessionRef: null },
      }));
    }

    return jsonOk(page, requestId);
  },
});
