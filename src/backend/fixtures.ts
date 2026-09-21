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

let loaded = false;

export function loadSyntheticFixtures(): void {
  if (loaded) return;
  loaded = true;

  // dim_feature_touchpoint / dim_user_cohort in the fixture files use the same feature keys as
  // store.ts's seeded touchpoints, but different UUIDs — remap fixture UUIDs to the store's
  // stable feature-key ids so fact rows join correctly against the already-seeded dimensions.
  const featureIdByFixtureId = new Map<string, string>();
  for (const f of dimFeatureTouchpoint as Array<{ featureTouchpointId: string; featureKey: string }>) {
    const storeFeature = store.featureByKey(f.featureKey);
    if (storeFeature) featureIdByFixtureId.set(f.featureTouchpointId, storeFeature.featureTouchpointId);
  }
  void dimUserCohort; // cohort dimension isn't joined by the current metrics queries yet

  for (const raw of factNpsResponse as Array<Record<string, any>>) {
    const row: NpsResponseRow = {
      responseId: raw.response_id,
      externalResponseId: raw.external_response_id ?? null,
      sourceSystem: raw.source_system,
      receivedAt: raw.received_at,
      surveyType: raw.survey_type,
      npsScore: raw.nps_score,
      npsTier: raw.nps_tier,
      featureTouchpointId: featureIdByFixtureId.get(raw.feature_touchpoint_id) ?? null,
      userCohortId: raw.user_cohort_id ?? null,
      sessionRef: raw.session_ref ?? null,
      channel: raw.channel,
      locale: raw.locale ?? null,
      responseEligible: raw.response_eligible,
      verbatimRedacted: raw.verbatim_redacted ?? null,
      redactionTags: raw.redaction_tags ?? [],
      redactionCount: raw.redaction_count ?? 0,
      redactionVersion: raw.redaction_version,
      sentimentScore: raw.sentiment_score ?? null,
      aspects: (raw.aspects ?? []) as Array<{ aspect: AspectKey; polarity: number; confidence: number }>,
      safetyFlag: raw.safety_flag,
      safetyReasonCodes: raw.safety_reason_codes ?? [],
      safetyConfidence: raw.safety_confidence ?? null,
      routeAction: raw.route_action ?? null,
      modelVersion: raw.model_version ?? null,
      classifierVersion: raw.classifier_version,
      processingStatus: raw.processing_status,
      createdAt: raw.created_at,
    };
    store.insertResponse(row);
  }

  for (const raw of factClosedLoopTicket as Array<Record<string, any>>) {
    const ticket: TicketRow = {
      ticketId: raw.ticket_id,
      responseId: raw.response_id,
      ticketType: raw.ticket_type,
      status: raw.status,
      priority: raw.priority,
      ownerTeam: raw.owner_team,
      createdAt: raw.created_at,
      firstContactAt: raw.first_contact_at ?? null,
      resolvedAt: raw.resolved_at ?? null,
      slaDueAt: raw.sla_due_at,
      slaBreachedAt: raw.sla_breached_at ?? null,
      resolutionCode: raw.resolution_code ?? null,
      lastUpdatedBy: raw.last_updated_by,
      version: raw.version,
      updatedAt: raw.updated_at,
    };
    store.tickets.push(ticket);
  }
}
