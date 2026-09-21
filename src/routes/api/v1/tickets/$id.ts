// §5.8 PATCH /api/v1/tickets/:id — state-machine validated, optimistic-concurrency ticket update.
import { createServerFileRoute } from "@tanstack/react-start/server";
import { updateTicketRequestSchema, type TicketStatus } from "@/server/contracts";
import { jsonError, jsonOk, newRequestId, parseBody } from "@/server/http";
import { requireWorkforceSession, requireRole, UnauthenticatedError, UnauthorisedError } from "@/server/auth";
import { store } from "@/server/store";

const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["contacted", "escalated"],
  contacted: ["resolved", "escalated"],
  escalated: ["contacted", "resolved"],
  resolved: [], // reopening requires elevated permission, handled separately below
};

export const ServerRoute = createServerFileRoute("/api/v1/tickets/$id").methods({
  PATCH: async ({ request, params }) => {
    const requestId = newRequestId();
    let session;
    try {
      session = requireWorkforceSession(request);
      requireRole(session, ["customer_success", "clinical_safety"]);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated", err.message, requestId);
      if (err instanceof UnauthorisedError) return jsonError(403, "unauthorised", err.message, requestId);
      throw err;
    }

    const parsed = await parseBody(request, updateTicketRequestSchema, requestId);
    if (!parsed.ok) return parsed.response;
    const { status: newStatus, version, resolutionCode, reason } = parsed.data;

    const ticket = store.ticketById(params.id);
    if (!ticket) return jsonError(404, "not_found", `Ticket ${params.id} was not found.`, requestId);

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

    // A P0 ticket can never be downgraded to a non-clinical ticket through this endpoint (§5.8).
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

    // Append-only history — never overwrite (§3.4).
    store.appendAudit({
      responseId: ticket.responseId,
      stage: "routing",
      status: "completed",
      detailCodes: [`ticket_status:${oldStatus}->${newStatus}`],
      requestId,
    });

    store.publish({
      type: "ticket.updated",
      id: ticket.ticketId,
      occurredAt: ticket.updatedAt,
      status: ticket.status,
      version: ticket.version,
    });

    return jsonOk(ticket, requestId);
  },
});
