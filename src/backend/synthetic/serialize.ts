import type { Corpus } from "./buildCorpus";

export interface SerializedFacts {
  "cohorts.jsonl": unknown[];
  "clinical_sessions.jsonl": unknown[];
  "survey_invitations.jsonl": unknown[];
  "nps_responses.jsonl": unknown[];
  "closed_loop_tickets.jsonl": unknown[];
  "page_events.jsonl": unknown[];
  "processing_audit.jsonl": unknown[];
  "redaction_quarantine.jsonl": unknown[];
  "theme_overrides.jsonl": unknown[];
  "product_telemetry.jsonl": unknown[];
}

/** Snake-case rows for COPY-style loads. Redacted text only; quarantine has no verbatim. */
export function serializedFacts(corpus: Corpus): SerializedFacts {
  return {
    "cohorts.jsonl": corpus.cohorts.map((cohort) => ({
      user_cohort_id: cohort.userCohortId,
      cohort_key: cohort.cohortKey,
      cohort_name: cohort.cohortName,
      tenure_band: cohort.tenureBand,
      plan_type: cohort.planType,
      is_active: cohort.isActive,
    })),
    "clinical_sessions.jsonl": corpus.sessions.map((session) => ({
      session_id: session.sessionId,
      started_at: session.startedAt,
      feature_key: session.featureKey,
      user_cohort_id: session.userCohortId,
      eligible_clinical: session.eligibleClinical,
      mismatch_codes: session.mismatchCodes,
      harm_codes: session.harmCodes,
      model_version: session.modelVersion,
    })),
    "survey_invitations.jsonl": corpus.invitations.map((invitation) => ({
      invitation_id: invitation.invitationId,
      session_id: invitation.sessionId,
      delivered_at: invitation.deliveredAt,
      eligible: invitation.eligible,
      feature_key: invitation.featureKey,
    })),
    "nps_responses.jsonl": corpus.responses.map((response) => ({
      response_id: response.responseId,
      external_response_id: response.externalResponseId,
      source_system: response.sourceSystem,
      received_at: response.receivedAt,
      survey_type: response.surveyType,
      nps_score: response.npsScore,
      nps_tier: response.npsTier,
      feature_key: response.featureKey,
      user_cohort_id: response.userCohortId,
      session_id: response.sessionId,
      invitation_id: response.invitationId,
      session_ref: response.sessionId,
      channel: response.channel,
      locale: response.locale,
      response_eligible: response.responseEligible,
      verbatim_redacted: response.verbatimRedacted,
      redaction_tags: response.redactionTags,
      redaction_count: response.redactionCount,
      redaction_version: response.redactionVersion,
      sentiment_score: response.sentimentScore,
      aspects: response.aspects,
      safety_flag: response.safetyFlag,
      safety_reason_codes: response.safetyReasonCodes,
      safety_confidence: response.safetyConfidence,
      route_action: response.routeAction,
      model_version: response.modelVersion,
      classifier_version: response.classifierVersion,
      processing_status: response.processingStatus,
      created_at: response.createdAt,
      anxiety_pre: response.anxietyPre,
      anxiety_post: response.anxietyPost,
      anxiety_pair_valid: response.anxietyPairValid,
      comprehension_applicable: response.comprehensionApplicable,
      understood_without_search: response.understoodWithoutSearch,
      disclaimer_exposed: response.disclaimerExposed,
      disclaimer_polarity: response.disclaimerPolarity,
    })),
    "closed_loop_tickets.jsonl": corpus.tickets.map((ticket) => ({
      ticket_id: ticket.ticketId,
      response_id: ticket.responseId,
      session_id: ticket.sessionId,
      ticket_type: ticket.ticketType,
      status: ticket.status,
      priority: ticket.priority,
      owner_team: ticket.ownerTeam,
      owner_id: ticket.ownerId,
      created_at: ticket.createdAt,
      first_contact_at: ticket.firstContactAt,
      resolved_at: ticket.resolvedAt,
      sla_due_at: ticket.slaDueAt,
      sla_breached_at: ticket.slaBreachedAt,
      resolution_code: ticket.resolutionCode,
      last_updated_by: ticket.lastUpdatedBy,
      version: ticket.version,
      updated_at: ticket.updatedAt,
    })),
    "page_events.jsonl": corpus.pages.map((page) => ({
      page_event_id: page.pageEventId,
      ticket_id: page.ticketId,
      delivered: page.delivered,
      sent_at: page.sentAt,
      acknowledged_at: page.acknowledgedAt,
      detail_code: page.detailCode,
    })),
    "processing_audit.jsonl": corpus.audits.map((audit) => ({
      audit_id: audit.auditId,
      response_id: audit.responseId,
      stage: audit.stage,
      status: audit.status,
      detail_codes: audit.detailCodes,
      occurred_at: audit.occurredAt,
      request_id: audit.requestId,
    })),
    "redaction_quarantine.jsonl": corpus.quarantines.map((row) => ({
      quarantine_id: row.quarantineId,
      occurred_at: row.occurredAt,
      stage: row.stage,
      status: row.status,
      detail_codes: row.detailCodes,
    })),
    "theme_overrides.jsonl": corpus.overrides.map((row) => ({
      override_id: row.overrideId,
      feature_key: row.featureKey,
      aspect: row.aspect,
      critical: row.critical,
      note: row.note,
    })),
    "product_telemetry.jsonl": corpus.telemetry.map((session) => ({
      session_id: session.sessionId,
      device: session.device,
      rage_clicks: session.rageClicks,
      dead_clicks: session.deadClicks,
      events: session.events,
      linked_response_id: session.linkedResponseId,
      cohort_key: session.cohortKey,
    })),
  };
}
