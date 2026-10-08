/**
 * Loads the quota corpus into the in-memory store. The corpus is built in process
 * (src/backend/synthetic/buildCorpus.ts) so the dev server does not static-import
 * the generated JSONL. Not for production use.
 */
import type { NpsResponseRow, TicketRow } from "./store";
import { store } from "./store";
import { buildCorpus } from "./synthetic/buildCorpus";

let loaded = false;

export function loadSyntheticFixtures(): void {
  if (loaded) return;
  loaded = true;

  const corpus = buildCorpus();
  for (const raw of corpus.responses) {
    const feature = store.featureByKey(raw.featureKey);
    const row: NpsResponseRow = {
      responseId: raw.responseId,
      externalResponseId: raw.externalResponseId,
      sourceSystem: raw.sourceSystem,
      receivedAt: raw.receivedAt,
      surveyType: raw.surveyType,
      npsScore: raw.npsScore,
      npsTier: raw.npsTier,
      featureTouchpointId: feature?.featureTouchpointId ?? null,
      userCohortId: raw.userCohortId,
      sessionRef: raw.sessionId,
      channel: raw.channel,
      locale: raw.locale,
      responseEligible: raw.responseEligible,
      verbatimRedacted: raw.verbatimRedacted,
      redactionTags: raw.redactionTags,
      redactionCount: raw.redactionCount,
      redactionVersion: raw.redactionVersion,
      sentimentScore: raw.sentimentScore,
      aspects: raw.aspects,
      safetyFlag: raw.safetyFlag,
      safetyReasonCodes: raw.safetyReasonCodes,
      safetyConfidence: raw.safetyConfidence,
      routeAction: raw.routeAction,
      modelVersion: raw.modelVersion,
      classifierVersion: raw.classifierVersion,
      processingStatus: raw.processingStatus,
      createdAt: raw.createdAt,
    };
    store.insertResponse(row);
  }

  for (const raw of corpus.tickets) {
    const ticket: TicketRow = {
      ticketId: raw.ticketId,
      responseId: raw.responseId,
      ticketType: raw.ticketType,
      status: raw.status,
      priority: raw.priority,
      ownerTeam: raw.ownerTeam,
      createdAt: raw.createdAt,
      firstContactAt: raw.firstContactAt,
      resolvedAt: raw.resolvedAt,
      slaDueAt: raw.slaDueAt,
      slaBreachedAt: raw.slaBreachedAt,
      resolutionCode: raw.resolutionCode,
      lastUpdatedBy: raw.lastUpdatedBy,
      version: raw.version,
      updatedAt: raw.updatedAt,
    };
    store.tickets.push(ticket);
  }
}
