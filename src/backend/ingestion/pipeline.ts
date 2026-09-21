/**
 * Ingestion pipeline orchestrator — runs the stages in the exact order required by §9.2:
 *
 *   ingress validation -> clinical-risk pre-check (raw text) -> deterministic PHI redaction
 *   -> [approved NER redaction] -> leakage scan -> classification (redacted text only)
 *   -> routing -> persistence -> audit -> realtime notification
 *
 * Used by both POST /api/v1/responses/ingest (persists) and POST /api/v1/workflow/simulate
 * (does not persist, per §5.6 — "must never create production tickets or pages").
 */
import { randomUUID } from "node:crypto";
import type { AspectKey, IngestResponseRequest, NpsTier, RouteAction } from "../contracts";
import { redact, verifyNoLeakage, REDACTION_VERSION } from "./redaction";
import { runSafetyGate, SAFETY_CLASSIFIER_VERSION } from "./safetyGate";
import { classifyAbsa, ABSA_CLASSIFIER_VERSION } from "./absa";
import { route as routeDecision } from "./routing";
import { store, type NpsResponseRow } from "../store";

function tierFor(score: number): NpsTier {
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

export interface PipelineStageTrace {
  name: "clinical_gate" | "phi_scrubber" | "absa_tagger" | "routing_engine";
  status: "passed" | "flagged" | "completed";
  durationMs: number;
}

export interface PipelineResult {
  redactedText: string;
  redactions: Array<{ tag: string; count: number }>;
  redactionCount: number;
  clinicalGate: { flagged: boolean; reasonCodes: string[]; confidence: number };
  sentiment: number;
  aspects: Array<{ aspect: AspectKey; polarity: number; confidence: number }>;
  routing: { action: RouteAction; priority: "p0" | "standard"; slaSeconds: number | null };
  stages: PipelineStageTrace[];
  leakageClean: boolean;
}

/**
 * Runs the classify+redact+route stages without touching the store. Safe for the sandbox
 * simulator (§5.6).
 */
export function runPipelineStages(
  rawText: string,
  score: number,
  reviewEligible: boolean,
): PipelineResult {
  const stages: PipelineStageTrace[] = [];

  let t0 = performance.now();
  const gate = runSafetyGate(rawText);
  stages.push({
    name: "clinical_gate",
    status: gate.flagged ? "flagged" : "passed",
    durationMs: performance.now() - t0,
  });

  t0 = performance.now();
  const { redactedText, redactions, redactionCount } = redact(rawText);
  const leakageClean = verifyNoLeakage(redactedText);
  stages.push({ name: "phi_scrubber", status: "completed", durationMs: performance.now() - t0 });

  t0 = performance.now();
  const absa = classifyAbsa(redactedText);
  stages.push({ name: "absa_tagger", status: "completed", durationMs: performance.now() - t0 });

  t0 = performance.now();
  const decision = routeDecision({
    score,
    safetyFlagged: gate.flagged,
    requiresImmediateReview: gate.requiresImmediateReview,
    reviewEligible,
  });
  stages.push({ name: "routing_engine", status: "completed", durationMs: performance.now() - t0 });

  return {
    redactedText,
    redactions,
    redactionCount,
    clinicalGate: {
      flagged: gate.flagged,
      reasonCodes: gate.reasonCodes,
      confidence: gate.confidence,
    },
    sentiment: absa.sentiment,
    aspects: absa.aspects,
    routing: decision,
    stages,
    leakageClean,
  };
}

/**
 * Full production path for POST /api/v1/responses/ingest: runs the pipeline, persists the
 * canonical response row, opens a ticket when routing requires one, writes the audit trail, and
 * publishes a realtime event. If redaction fails leakage verification, the record is quarantined
 * (processing_status = 'failed') and no downstream classifier/model call is made, per §5.7.
 */
export function ingest(request: IngestResponseRequest, requestId: string) {
  const responseId = randomUUID();
  const receivedAt = request.receivedAt ?? new Date().toISOString();
  const feature = request.featureKey ? store.featureByKey(request.featureKey) : undefined;

  store.appendAudit({
    responseId,
    stage: "ingress",
    status: "completed",
    detailCodes: [],
    requestId,
  });

  const rawText = request.rawText ?? "";
  const gate = runSafetyGate(rawText);
  store.appendAudit({
    responseId,
    stage: "clinical_pre_check",
    status: gate.flagged ? "flagged" : "passed",
    detailCodes: gate.reasonCodes,
    requestId,
  });

  const { redactedText, redactions, redactionCount } = redact(rawText);
  store.appendAudit({
    responseId,
    stage: "phi_redaction",
    status: "completed",
    detailCodes: [],
    requestId,
  });

  const leakageClean = verifyNoLeakage(redactedText);
  store.appendAudit({
    responseId,
    stage: "leakage_scan",
    status: leakageClean ? "passed" : "failed",
    detailCodes: [],
    requestId,
  });

  if (!leakageClean) {
    // Quarantine: persist minimally, do not classify, do not route.
    const quarantined: NpsResponseRow = {
      responseId,
      externalResponseId: request.externalResponseId ?? null,
      sourceSystem: request.sourceSystem,
      receivedAt,
      surveyType: request.surveyType,
      npsScore: request.score,
      npsTier: tierFor(request.score),
      featureTouchpointId: feature?.featureTouchpointId ?? null,
      userCohortId: null,
      sessionRef: request.sessionRef ?? null,
      channel: request.channel,
      locale: request.locale ?? null,
      responseEligible: true,
      verbatimRedacted: null,
      redactionTags: [],
      redactionCount: 0,
      redactionVersion: REDACTION_VERSION,
      sentimentScore: null,
      aspects: [],
      safetyFlag: gate.flagged,
      safetyReasonCodes: gate.reasonCodes,
      safetyConfidence: gate.flagged ? gate.confidence : null,
      routeAction: null,
      modelVersion: request.modelVersion ?? null,
      classifierVersion: SAFETY_CLASSIFIER_VERSION,
      processingStatus: "failed",
      createdAt: new Date().toISOString(),
    };
    store.insertResponse(quarantined);
    return { responseId, processingStatus: "failed" as const };
  }

  // Classification runs on redacted text only, per §5.7/§9.2.
  const absa = classifyAbsa(redactedText);
  store.appendAudit({
    responseId,
    stage: "classification",
    status: "completed",
    detailCodes: [],
    requestId,
  });

  const decision = routeDecision({
    score: request.score,
    safetyFlagged: gate.flagged,
    requiresImmediateReview: gate.requiresImmediateReview,
    reviewEligible: request.score >= 9,
  });
  store.appendAudit({
    responseId,
    stage: "routing",
    status: "completed",
    detailCodes: [decision.action],
    requestId,
  });

  const row: NpsResponseRow = {
    responseId,
    externalResponseId: request.externalResponseId ?? null,
    sourceSystem: request.sourceSystem,
    receivedAt,
    surveyType: request.surveyType,
    npsScore: request.score,
    npsTier: tierFor(request.score),
    featureTouchpointId: feature?.featureTouchpointId ?? null,
    userCohortId: null,
    sessionRef: request.sessionRef ?? null,
    channel: request.channel,
    locale: request.locale ?? null,
    responseEligible: true,
    verbatimRedacted: redactedText || null,
    redactionTags: redactions.map((r) => r.tag),
    redactionCount,
    redactionVersion: REDACTION_VERSION,
    sentimentScore: absa.sentiment,
    aspects: absa.aspects,
    safetyFlag: gate.flagged,
    safetyReasonCodes: gate.reasonCodes,
    safetyConfidence: gate.flagged ? gate.confidence : null,
    routeAction: decision.action,
    modelVersion: request.modelVersion ?? null,
    classifierVersion: ABSA_CLASSIFIER_VERSION,
    processingStatus: "routed",
    createdAt: new Date().toISOString(),
  };
  store.insertResponse(row);

  if (decision.action === "p0_clinical_page" || decision.action === "cs_ticket") {
    const slaDueAt = new Date(Date.now() + (decision.slaSeconds ?? 0) * 1000).toISOString();
    store.createTicket({
      responseId,
      ticketType: decision.action === "p0_clinical_page" ? "p0_clinical" : "customer_success",
      status: "open",
      priority: decision.priority,
      ownerTeam: decision.action === "p0_clinical_page" ? "clinical_safety" : "customer_success",
      firstContactAt: null,
      resolvedAt: null,
      slaDueAt,
      slaBreachedAt: null,
      resolutionCode: null,
      lastUpdatedBy: "system",
    });
  }

  store.appendAudit({
    responseId,
    stage: "notification",
    status: "completed",
    detailCodes: [],
    requestId,
  });

  if (decision.action === "p0_clinical_page") {
    store.publish({
      type: "safety.p0_created",
      id: responseId,
      occurredAt: new Date().toISOString(),
      reasonCodes: gate.reasonCodes,
    });
  }
  store.publish({
    type: "response.processed",
    id: responseId,
    occurredAt: new Date().toISOString(),
    affectedFeature: request.featureKey ?? "unknown",
  });
  store.publish({
    type: "metrics.invalidated",
    occurredAt: new Date().toISOString(),
    scopes: ["executive", "features", "quadrant", "absa"],
  });

  return { responseId, processingStatus: "routed" as const };
}
