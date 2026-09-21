/**
 * In-memory Repository implementation — wraps the original scaffold (store.ts, metrics.ts,
 * verbatims.ts, ingestion/pipeline.ts) behind the shared Repository interface. Used when
 * DATABASE_URL is not set. Not for production use — see data/synthetic/README.md.
 */
import type { AnalyticsFilters, IngestResponseRequest, VerbatimQuery } from "../contracts";
import { store } from "../store";
import { getAbsaRows, getExecutiveMetrics, getFeatureMetrics, getQuadrant } from "../metrics";
import { queryVerbatims } from "../verbatims";
import { ingest as runIngest } from "../ingestion/pipeline";
import { isAllowedTransition } from "../ticketRules";
import type { IngestOutcome, Repository, TicketSnapshot, UpdateTicketResult } from "./types";

function toSnapshot(t: (typeof store.tickets)[number]): TicketSnapshot {
  return { ...t };
}

export function createMemoryRepository(): Repository {
  return {
    kind: "memory",

    async getExecutiveMetrics(filters: AnalyticsFilters) {
      return getExecutiveMetrics(filters);
    },
    async getFeatureMetrics(filters: AnalyticsFilters) {
      return getFeatureMetrics(filters);
    },
    async getQuadrant(filters: AnalyticsFilters, minVolume: number, criticalOnly?: boolean) {
      return getQuadrant(filters, minVolume, criticalOnly);
    },
    async getAbsaRows(filters: AnalyticsFilters) {
      return getAbsaRows(filters);
    },
    async queryVerbatims(query: VerbatimQuery) {
      return queryVerbatims(query);
    },

    async findExistingIngest(sourceSystem: string, externalResponseId: string | undefined) {
      const existing = store.findByExternalId(sourceSystem, externalResponseId);
      if (!existing) return null;
      return {
        responseId: existing.responseId,
        processingStatus: existing.processingStatus,
        routeAction: existing.routeAction,
        safetyFlag: existing.safetyFlag,
        safetyReasonCodes: existing.safetyReasonCodes,
      };
    },

    async ingestResponse(
      request: IngestResponseRequest,
      requestId: string,
    ): Promise<IngestOutcome> {
      const result = runIngest(request, requestId);
      const row = store.responses.find((r) => r.responseId === result.responseId)!;
      return {
        responseId: row.responseId,
        processingStatus: row.processingStatus,
        routeAction: row.routeAction,
        safetyFlag: row.safetyFlag,
        safetyReasonCodes: row.safetyReasonCodes,
      };
    },

    async getTicket(ticketId: string) {
      const ticket = store.ticketById(ticketId);
      return ticket ? toSnapshot(ticket) : null;
    },

    async updateTicket(ticketId, patch): Promise<UpdateTicketResult> {
      const ticket = store.ticketById(ticketId);
      if (!ticket) return { ok: false, reason: "not_found" };
      if (ticket.version !== patch.version) return { ok: false, reason: "version_conflict" };

      const reopeningResolved = ticket.status === "resolved" && patch.status !== "resolved";
      const allowed = isAllowedTransition(ticket.status, patch.status);
      if (!allowed && !(reopeningResolved && patch.allowReopenResolved)) {
        return { ok: false, reason: "invalid_transition", from: ticket.status, to: patch.status };
      }
      if (reopeningResolved && !patch.reason) return { ok: false, reason: "reason_required" };
      if (
        ticket.ticketType === "p0_clinical" &&
        patch.status === "resolved" &&
        !patch.resolutionCode
      ) {
        return { ok: false, reason: "resolution_code_required" };
      }

      const oldStatus = ticket.status;
      ticket.status = patch.status;
      ticket.version += 1;
      ticket.updatedAt = new Date().toISOString();
      if (patch.status === "contacted" && !ticket.firstContactAt)
        ticket.firstContactAt = ticket.updatedAt;
      if (patch.status === "resolved") ticket.resolvedAt = ticket.updatedAt;
      if (patch.resolutionCode) ticket.resolutionCode = patch.resolutionCode;
      ticket.lastUpdatedBy = patch.actorId;

      store.appendAudit({
        responseId: ticket.responseId,
        stage: "routing",
        status: "completed",
        detailCodes: [`ticket_status:${oldStatus}->${patch.status}`],
        requestId: "n/a",
      });
      store.publish({
        type: "ticket.updated",
        id: ticket.ticketId,
        occurredAt: ticket.updatedAt,
        status: ticket.status,
        version: ticket.version,
      });

      return { ok: true, ticket: toSnapshot(ticket) };
    },

    subscribeRealtime(fn) {
      return store.subscribe(fn);
    },
  };
}
