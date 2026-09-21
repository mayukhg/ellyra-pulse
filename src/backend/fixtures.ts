/**
 * Loads the synthetic dataset in data/synthetic/ into the in-memory store, for local
 * development and demos. See data/synthetic/README.md for how the data was generated.
 *
 * Not for production use — this seeds the same process-local store described in
 * src/server/store.ts.
 */
import dimFeatureTouchpoint from "../../data/synthetic/dim_feature_touchpoint.json";
import dimUserCohort from "../../data/synthetic/dim_user_cohort.json";
import factNpsResponse from "../../data/synthetic/fact_nps_response.json";
import factClosedLoopTicket from "../../data/synthetic/fact_closed_loop_ticket.json";
import type { AspectKey } from "./contracts";
import { store, type NpsResponseRow, type TicketRow } from "./store";

// Named fields (not Record<string, any>) so property access doesn't trip
// noPropertyAccessFromIndexSignature.
interface SyntheticResponseFixture {
  response_id: string;
  external_response_id: string | null;
  source_system: string;
  received_at: string;
  survey_type: string;
  nps_score: number;
  nps_tier: string;
  feature_touchpoint_id: string;
  user_cohort_id: string | null;
  session_ref: string | null;
  channel: string;
  locale: string | null;
  response_eligible: boolean;
  verbatim_redacted: string | null;
  redaction_tags: string[];
  redaction_count: number;
  redaction_version: string;
  sentiment_score: number | null;
  aspects: Array<{ aspect: AspectKey; polarity: number; confidence: number }>;
  safety_flag: boolean;
  safety_reason_codes: string[];
  safety_confidence: number | null;
  route_action: string | null;
  model_version: string | null;
  classifier_version: string;
  processing_status: NpsResponseRow["processingStatus"];
  created_at: string;
}

interface SyntheticTicketFixture {
  ticket_id: string;
  response_id: string;
  ticket_type: TicketRow["ticketType"];
  status: TicketRow["status"];
  priority: TicketRow["priority"];
  owner_team: string;
  created_at: string;
  first_contact_at: string | null;
  resolved_at: string | null;
  sla_due_at: string;
  sla_breached_at: string | null;
  resolution_code: string | null;
  last_updated_by: string;
  version: number;
  updated_at: string;
}

let loaded = false;

export function loadSyntheticFixtures(): void {
  if (loaded) return;
  loaded = true;

  // dim_feature_touchpoint / dim_user_cohort in the fixture files use the same feature keys as
  // store.ts's seeded touchpoints, but different UUIDs — remap fixture UUIDs to the store's
  // stable feature-key ids so fact rows join correctly against the already-seeded dimensions.
  const featureIdByFixtureId = new Map<string, string>();
  for (const f of dimFeatureTouchpoint as Array<{
    featureTouchpointId: string;
    featureKey: string;
  }>) {
    const storeFeature = store.featureByKey(f.featureKey);
    if (storeFeature)
      featureIdByFixtureId.set(f.featureTouchpointId, storeFeature.featureTouchpointId);
  }
  void dimUserCohort; // cohort dimension isn't joined by the current metrics queries yet

  for (const raw of factNpsResponse as unknown as SyntheticResponseFixture[]) {
    const row: NpsResponseRow = {
      responseId: raw.response_id,
      externalResponseId: raw.external_response_id,
      sourceSystem: raw.source_system,
      receivedAt: raw.received_at,
      surveyType: raw.survey_type as NpsResponseRow["surveyType"],
      npsScore: raw.nps_score,
      npsTier: raw.nps_tier as NpsResponseRow["npsTier"],
      featureTouchpointId: featureIdByFixtureId.get(raw.feature_touchpoint_id) ?? null,
      userCohortId: raw.user_cohort_id,
      sessionRef: raw.session_ref,
      channel: raw.channel,
      locale: raw.locale,
      responseEligible: raw.response_eligible,
      verbatimRedacted: raw.verbatim_redacted,
      redactionTags: raw.redaction_tags,
      redactionCount: raw.redaction_count,
      redactionVersion: raw.redaction_version,
      sentimentScore: raw.sentiment_score,
      aspects: raw.aspects,
      safetyFlag: raw.safety_flag,
      safetyReasonCodes: raw.safety_reason_codes,
      safetyConfidence: raw.safety_confidence,
      routeAction: raw.route_action as NpsResponseRow["routeAction"],
      modelVersion: raw.model_version,
      classifierVersion: raw.classifier_version,
      processingStatus: raw.processing_status,
      createdAt: raw.created_at,
    };
    store.insertResponse(row);
  }

  for (const raw of factClosedLoopTicket as unknown as SyntheticTicketFixture[]) {
    const ticket: TicketRow = {
      ticketId: raw.ticket_id,
      responseId: raw.response_id,
      ticketType: raw.ticket_type,
      status: raw.status,
      priority: raw.priority,
      ownerTeam: raw.owner_team,
      createdAt: raw.created_at,
      firstContactAt: raw.first_contact_at,
      resolvedAt: raw.resolved_at,
      slaDueAt: raw.sla_due_at,
      slaBreachedAt: raw.sla_breached_at,
      resolutionCode: raw.resolution_code,
      lastUpdatedBy: raw.last_updated_by,
      version: raw.version,
      updatedAt: raw.updated_at,
    };
    store.tickets.push(ticket);
  }
}
