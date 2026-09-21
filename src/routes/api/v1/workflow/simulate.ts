// §5.6 POST /api/v1/workflow/simulate — sandbox only, never creates production tickets/pages.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { randomUUID } from "node:crypto";
import { simulateWorkflowRequestSchema, type SimulateWorkflowResponse } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseBody } from "@/server/http";
import { requireWorkforceSession, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { runPipelineStages } from "@/server/ingestion/pipeline";
import { ABSA_CLASSIFIER_VERSION } from "@/server/ingestion/absa";

// TODO: rate-limit by user and organisation (§5.6) once the auth layer carries org identity.

export const ServerRoute = createServerFileRoute("/api/v1/workflow/simulate").methods({
  POST: async ({ request }) => {
    const requestId = newRequestId();
    try {
      requireWorkforceSession(request);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    const parsed = await parseBody(request, simulateWorkflowRequestSchema, requestId);
    if (!parsed.ok) return parsed.response;
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

    // Simulator input is not retained beyond this response, per §5.6.
    return jsonOk(response, requestId);
  },
});
