/**
 * Repository interface — the seam between API handlers (src/backend/router.ts) and storage.
 * Two implementations: memory.ts (the original in-memory scaffold) and postgres.ts (real
 * Postgres, per docs/DESIGN_UI.md §3). Selected once at startup by index.ts based on whether
 * DATABASE_URL is set. Every read/write the router needs goes through this interface so the
 * storage backend can change without touching the HTTP layer.
 */
import type {
  AbsaRowDto,
  AnalyticsFilters,
  CursorPage,
  ExecutiveMetricsResponse,
  FeatureMetric,
  IngestResponseRequest,
  QuadrantPointDto,
  RealtimeEvent,
  TicketStatus,
  VerbatimListItem,
  VerbatimQuery,
} from "../contracts";

export interface TicketSnapshot {
  ticketId: string;
  responseId: string;
  ticketType: "p0_clinical" | "customer_success";
  status: TicketStatus;
  priority: "p0" | "p1" | "standard";
  ownerTeam: string;
  createdAt: string;
  firstContactAt: string | null;
  resolvedAt: string | null;
  slaDueAt: string;
  slaBreachedAt: string | null;
  resolutionCode: string | null;
  lastUpdatedBy: string;
  version: number;
  updatedAt: string;
}

export type UpdateTicketResult =
  | { ok: true; ticket: TicketSnapshot }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_conflict" }
  | { ok: false; reason: "invalid_transition"; from: TicketStatus; to: TicketStatus }
  | { ok: false; reason: "reason_required" }
  | { ok: false; reason: "resolution_code_required" };

export interface IngestOutcome {
  responseId: string;
  processingStatus: "received" | "redacted" | "classified" | "routed" | "failed";
  routeAction: string | null;
  safetyFlag: boolean;
  safetyReasonCodes: string[];
}

export interface Repository {
  readonly kind: "memory" | "postgres";

  getExecutiveMetrics(filters: AnalyticsFilters): Promise<ExecutiveMetricsResponse>;
  getFeatureMetrics(filters: AnalyticsFilters): Promise<FeatureMetric[]>;
  getQuadrant(
    filters: AnalyticsFilters,
    minVolume: number,
    criticalOnly?: boolean,
  ): Promise<QuadrantPointDto[]>;
  getAbsaRows(filters: AnalyticsFilters): Promise<AbsaRowDto[]>;
  queryVerbatims(query: VerbatimQuery): Promise<CursorPage<VerbatimListItem>>;

  findExistingIngest(
    sourceSystem: string,
    externalResponseId: string | undefined,
  ): Promise<IngestOutcome | null>;
  /** Runs the full ingestion pipeline (redaction, safety gate, ABSA, routing) and persists the
   * result, including opening a ticket when routing requires one. */
  ingestResponse(request: IngestResponseRequest, requestId: string): Promise<IngestOutcome>;

  getTicket(ticketId: string): Promise<TicketSnapshot | null>;
  updateTicket(
    ticketId: string,
    patch: {
      status: TicketStatus;
      version: number;
      resolutionCode?: string | undefined;
      reason?: string | undefined;
      actorId: string;
      allowReopenResolved: boolean;
    },
  ): Promise<UpdateTicketResult>;

  subscribeRealtime(fn: (event: RealtimeEvent) => void): () => void;
}
