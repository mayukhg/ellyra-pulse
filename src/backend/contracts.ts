/**
 * Shared backend contracts — mirrors docs/UI_INTEGRATION_REQUIREMENTS.md §4 (TypeScript
 * contracts) and adds the zod runtime schemas needed to validate requests at the API boundary.
 * Keep these types in sync with §3 (canonical data model) and §5 (API requirements).
 */
import { z } from "zod";

export type IsoDateTime = string;
export type NpsTier = "promoter" | "passive" | "detractor";
export type SurveyType = "relational" | "transactional";
export type TicketStatus = "open" | "contacted" | "resolved" | "escalated";
export type RouteAction = "p0_clinical_page" | "cs_ticket" | "review_prompt" | "micro_poll";

export const ASPECT_TAXONOMY = [
  "clinical_trust",
  "tone_and_bedside_manner",
  "document_parsing_ocr",
  "actionability",
  "billing_cost",
  "ui_confusion",
  "response_speed",
] as const;
export type AspectKey = (typeof ASPECT_TAXONOMY)[number];

export const CLINICAL_ASPECTS: ReadonlySet<AspectKey> = new Set([
  "clinical_trust",
  "tone_and_bedside_manner",
  "document_parsing_ocr",
  "actionability",
]);

export const FEATURE_TOUCHPOINTS = [
  "lab_blood_parser",
  "mri_imaging_insights",
  "symptom_chat_companion",
  "gp_question_builder",
] as const;
export type FeatureKey = (typeof FEATURE_TOUCHPOINTS)[number];

export const REDACTION_TAGS = [
  "DOB",
  "NAME",
  "MRN",
  "NHS_NUMBER",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "MEMBER_ID",
  "IDENTIFIER",
] as const;
export type RedactionTag = (typeof REDACTION_TAGS)[number];

export const SAFETY_REASON_CODES = [
  "ocr_unit_mismatch",
  "missed_abnormal_marker",
  "contradicts_clinician",
  "false_reassurance",
  "urgent_symptom_minimisation",
  "self_harm_or_emergency",
  "medication_danger",
] as const;
export type SafetyReasonCode = (typeof SAFETY_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Query filters (§4 AnalyticsFilters, used by every read endpoint in §5)
// ---------------------------------------------------------------------------

export const analyticsFiltersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
  feature: z.enum(FEATURE_TOUCHPOINTS).optional(),
  cohort: z.string().optional(),
  aspect: z.enum(ASPECT_TAXONOMY).optional(),
  surveyType: z.enum(["relational", "transactional"]).optional(),
  timezone: z.string().default("UTC"),
});
export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;

// ---------------------------------------------------------------------------
// Response DTOs (§4)
// ---------------------------------------------------------------------------

export interface MetricValue {
  value: number;
  previousValue: number | null;
  delta: number | null;
  numerator?: number;
  denominator?: number;
  status?: "healthy" | "watch" | "alarm";
  target?: { operator: "gt" | "gte" | "lt" | "lte"; value: number };
}

export interface NpsDistribution {
  promotersPct: number;
  passivesPct: number;
  detractorsPct: number;
  promotersCount: number;
  passivesCount: number;
  detractorsCount: number;
}

export interface ExecutiveMetricsResponse {
  generatedAt: IsoDateTime;
  period: { from: string; to: string; timezone: string };
  sample: { responses: number; eligibleSurveys: number; suppressed: boolean };
  nps: {
    overall: MetricValue;
    relational: MetricValue;
    transactional: MetricValue;
    responseRate: MetricValue;
    distribution: NpsDistribution;
    trend: Array<{ period: string; relational: number; transactional: number }>;
  };
  medicalTrust: {
    anxietyReductionDelta: MetricValue;
    clinicalComprehensionScore: MetricValue;
    hallucinationFlagRate: MetricValue;
    disclaimerFatigueIndex: MetricValue;
  };
  closedLoop: {
    medianTimeToFirstContactSeconds: number | null;
    closeRate: MetricValue;
    openP0Count: number;
  };
}

export interface FeatureMetric {
  featureKey: string;
  featureName: string;
  nps: number;
  monthOverMonthDelta: number | null;
  responseCount: number;
  distribution: NpsDistribution;
  topDriver: { aspect: string; label: string; impact: number } | null;
  safetyFlagCount: number;
}

export interface QuadrantPointDto {
  id: string;
  theme: string;
  featureKey: string;
  aspect: string;
  volume: number;
  netSentimentImpact: number;
  critical: boolean;
  note: string;
}

export interface AbsaRowDto {
  aspect: string;
  category: "clinical" | "operational";
  mentions: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
}

export interface VerbatimListItem {
  id: string;
  receivedAt: IsoDateTime;
  score: number;
  tier: NpsTier;
  sentiment: number;
  feature: { key: string; name: string };
  surveyType: SurveyType;
  text: string; // redacted only — never raw
  redactions: Array<{ tag: string; count: number }>;
  aspects: Array<{ aspect: string; polarity: number; confidence: number }>;
  safety: { flagged: boolean; reasonCodes: string[] };
  routeAction: RouteAction;
  ticket: null | {
    id: string;
    status: TicketStatus;
    slaDueAt: IsoDateTime;
    breached: boolean;
  };
  telemetry: {
    sessionRef: string | null;
    modelVersion: string | null;
    deviceFamily: string | null;
    channel: string;
  };
}

export interface CursorPage<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { requestId: string; generatedAt: IsoDateTime };
}

// ---------------------------------------------------------------------------
// Request schemas (§5)
// ---------------------------------------------------------------------------

export const verbatimQuerySchema = analyticsFiltersSchema.extend({
  polarity: z.enum(["positive", "negative", "neutral"]).optional(),
  safetyRisk: z.coerce.boolean().optional(),
  slaStatus: z.enum(["open", "contacted", "resolved", "escalated"]).optional(),
  theme: z.string().optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["received_desc", "sla_due_asc"]).default("received_desc"),
});
export type VerbatimQuery = z.infer<typeof verbatimQuerySchema>;

export const quadrantQuerySchema = analyticsFiltersSchema.extend({
  minVolume: z.coerce.number().int().min(0).default(0),
  criticalOnly: z.coerce.boolean().optional(),
});

export const simulateWorkflowRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  score: z.number().int().min(0).max(10),
  featureKey: z.enum(FEATURE_TOUCHPOINTS),
  surveyType: z.enum(["relational", "transactional"]),
  locale: z.string().optional(),
});
export type SimulateWorkflowRequest = z.infer<typeof simulateWorkflowRequestSchema>;

export interface SimulateWorkflowResponse {
  simulationId: string;
  redactedText: string;
  redactions: Array<{ tag: string; count: number }>;
  clinicalGate: { flagged: boolean; reasonCodes: string[]; confidence: number };
  analysis: {
    sentiment: number;
    aspects: Array<{ aspect: string; polarity: number; confidence: number }>;
    classifierVersion: string;
  };
  routing: { action: RouteAction; priority: "p0" | "standard"; slaSeconds: number | null };
  stages: Array<{
    name: "clinical_gate" | "phi_scrubber" | "absa_tagger" | "routing_engine";
    status: "passed" | "flagged" | "completed";
    durationMs: number;
  }>;
}

// Production ingestion — raw text travels only inside this request, never on a shared bus.
export const ingestResponseSchema = z.object({
  externalResponseId: z.string().min(1).max(200).optional(),
  sourceSystem: z.string().min(1),
  surveyType: z.enum(["relational", "transactional"]),
  score: z.number().int().min(0).max(10),
  featureKey: z.enum(FEATURE_TOUCHPOINTS).optional(),
  channel: z.string().min(1),
  locale: z.string().optional(),
  sessionRef: z.string().optional(),
  modelVersion: z.string().optional(),
  rawText: z.string().max(8000).optional(),
  receivedAt: z.string().datetime().optional(),
});
export type IngestResponseRequest = z.infer<typeof ingestResponseSchema>;

export const updateTicketRequestSchema = z.object({
  status: z.enum(["open", "contacted", "resolved", "escalated"]),
  version: z.number().int().min(0),
  resolutionCode: z.string().optional(),
  reason: z.string().optional(),
});
export type UpdateTicketRequest = z.infer<typeof updateTicketRequestSchema>;

// ---------------------------------------------------------------------------
// Error envelope (§6)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Record<string, string[]>;
    retryable: boolean;
  };
}

// ---------------------------------------------------------------------------
// Realtime events (§7)
// ---------------------------------------------------------------------------

export type RealtimeEvent =
  | { type: "response.processed"; id: string; occurredAt: IsoDateTime; affectedFeature: string }
  | { type: "safety.p0_created"; id: string; occurredAt: IsoDateTime; reasonCodes: string[] }
  | { type: "ticket.updated"; id: string; occurredAt: IsoDateTime; status: TicketStatus; version: number }
  | {
      type: "metrics.invalidated";
      occurredAt: IsoDateTime;
      scopes: Array<"executive" | "features" | "quadrant" | "absa">;
    };
