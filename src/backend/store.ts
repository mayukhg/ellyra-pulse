/**
 * In-memory data store — a stand-in for the Postgres schema in db/migrations/0001_init.sql.
 *
 * This lets the API routes and ingestion pipeline be exercised end to end before a real
 * database is provisioned (implementation guide step 3-5 in the integration spec). Swap this
 * module for real repository/query code without changing the route handlers' call shape —
 * every function here mirrors a query or write the real repositories will need.
 *
 * Not for production use: no persistence across process restarts, no transactions, no
 * concurrency control beyond the ticket `version` check.
 */
import { randomUUID } from "node:crypto";
import {
  FEATURE_TOUCHPOINTS,
  type AspectKey,
  type FeatureKey,
  type NpsTier,
  type RealtimeEvent,
  type RouteAction,
  type SurveyType,
  type TicketStatus,
} from "./contracts";

export interface FeatureTouchpoint {
  featureTouchpointId: string;
  featureKey: FeatureKey;
  featureName: string;
  productArea: string;
  touchpointType: string;
  isClinical: boolean;
}

export interface NpsResponseRow {
  responseId: string;
  externalResponseId: string | null;
  sourceSystem: string;
  receivedAt: string;
  surveyType: SurveyType;
  npsScore: number;
  npsTier: NpsTier;
  featureTouchpointId: string | null;
  userCohortId: string | null;
  sessionRef: string | null;
  channel: string;
  locale: string | null;
  responseEligible: boolean;
  verbatimRedacted: string | null;
  redactionTags: string[];
  redactionCount: number;
  redactionVersion: string;
  sentimentScore: number | null;
  aspects: Array<{ aspect: AspectKey; polarity: number; confidence: number }>;
  safetyFlag: boolean;
  safetyReasonCodes: string[];
  safetyConfidence: number | null;
  routeAction: RouteAction | null;
  modelVersion: string | null;
  classifierVersion: string;
  processingStatus: "received" | "redacted" | "classified" | "routed" | "failed";
  createdAt: string;
}

export interface TicketRow {
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

export interface AuditEvent {
  auditId: string;
  responseId: string;
  stage: string;
  status: "passed" | "flagged" | "failed" | "completed";
  detailCodes: string[];
  occurredAt: string;
  requestId: string;
}

function nowIso() {
  return new Date().toISOString();
}

function seedFeatureTouchpoints(): FeatureTouchpoint[] {
  const names: Record<FeatureKey, { name: string; area: string; type: string; clinical: boolean }> =
    {
      lab_blood_parser: {
        name: "Lab / Blood Report Parser",
        area: "lab",
        type: "report",
        clinical: true,
      },
      mri_imaging_insights: {
        name: "MRI / Imaging Insights",
        area: "imaging",
        type: "report",
        clinical: true,
      },
      symptom_chat_companion: {
        name: "Symptom Chat Companion",
        area: "chat",
        type: "conversation",
        clinical: true,
      },
      gp_question_builder: {
        name: "GP Question Builder",
        area: "gp_prep",
        type: "builder",
        clinical: false,
      },
    };
  return FEATURE_TOUCHPOINTS.map((key) => ({
    featureTouchpointId: key, // stable id == key in this in-memory scaffold
    featureKey: key,
    ...(() => {
      const n = names[key];
      return {
        featureName: n.name,
        productArea: n.area,
        touchpointType: n.type,
        isClinical: n.clinical,
      };
    })(),
  }));
}

class InMemoryStore {
  featureTouchpoints = seedFeatureTouchpoints();
  responses: NpsResponseRow[] = [];
  tickets: TicketRow[] = [];
  auditEvents: AuditEvent[] = [];
  private subscribers = new Set<(event: RealtimeEvent) => void>();

  featureByKey(key: string): FeatureTouchpoint | undefined {
    return this.featureTouchpoints.find((f) => f.featureKey === key);
  }

  findByExternalId(sourceSystem: string, externalResponseId: string | undefined) {
    if (!externalResponseId) return undefined;
    return this.responses.find(
      (r) => r.sourceSystem === sourceSystem && r.externalResponseId === externalResponseId,
    );
  }

  insertResponse(row: NpsResponseRow) {
    this.responses.push(row);
    return row;
  }

  appendAudit(event: Omit<AuditEvent, "auditId" | "occurredAt">) {
    const full: AuditEvent = { ...event, auditId: randomUUID(), occurredAt: nowIso() };
    this.auditEvents.push(full);
    return full;
  }

  createTicket(
    input: Omit<TicketRow, "ticketId" | "version" | "updatedAt" | "createdAt"> & {
      createdAt?: string;
    },
  ) {
    const ticket: TicketRow = {
      ...input,
      ticketId: randomUUID(),
      createdAt: input.createdAt ?? nowIso(),
      version: 0,
      updatedAt: nowIso(),
    };
    this.tickets.push(ticket);
    return ticket;
  }

  ticketByResponseId(responseId: string) {
    return this.tickets.find((t) => t.responseId === responseId);
  }

  ticketById(ticketId: string) {
    return this.tickets.find((t) => t.ticketId === ticketId);
  }

  publish(event: RealtimeEvent) {
    for (const sub of this.subscribers) sub(event);
  }

  subscribe(fn: (event: RealtimeEvent) => void) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

// A module-level singleton is adequate for a single-process scaffold. Once a real database is
// wired in (implementation guide step 3), delete this file and replace imports with repository
// modules backed by the migrations in db/migrations/.
export const store = new InMemoryStore();
