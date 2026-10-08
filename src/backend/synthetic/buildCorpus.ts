import type { AspectKey, FeatureKey, NpsTier, RouteAction, SurveyType } from "../contracts";
import { addSeconds, stableId, timestampIn } from "./ids";
import {
  ARD,
  BUCKETS,
  CCS,
  CLOCKS,
  COHORTS,
  DEFAULT_SEED,
  DFI,
  HARM_CODES,
  MISMATCH_CODES,
  PINNED_THEMES,
  QUARANTINE_PER_BUCKET,
  SUPPRESSION,
  TELEMETRY,
  featureCounts,
  type BucketQuota,
  type ClockQuota,
  type CohortKey,
  type TierCounts,
} from "./quotas";

export interface CorpusCohort {
  userCohortId: string;
  cohortKey: CohortKey;
  cohortName: string;
  tenureBand: string;
  planType: string;
  isActive: boolean;
}

export interface CorpusSession {
  sessionId: string;
  startedAt: string;
  featureKey: FeatureKey;
  userCohortId: string | null;
  eligibleClinical: boolean;
  mismatchCodes: string[];
  harmCodes: string[];
  bucketId: BucketQuota["id"];
}

export interface CorpusInvitation {
  invitationId: string;
  sessionId: string;
  deliveredAt: string;
  eligible: boolean;
  featureKey: FeatureKey;
  bucketId: BucketQuota["id"];
}

export interface CorpusAspect {
  aspect: AspectKey;
  polarity: number;
  confidence: number;
}

export interface CorpusResponse {
  responseId: string;
  externalResponseId: string;
  sourceSystem: string;
  receivedAt: string;
  surveyType: SurveyType;
  npsScore: number;
  npsTier: NpsTier;
  featureKey: FeatureKey;
  userCohortId: string;
  cohortKey: CohortKey;
  sessionId: string;
  invitationId: string;
  channel: string;
  locale: string;
  responseEligible: boolean;
  verbatimRedacted: string;
  redactionTags: string[];
  redactionCount: number;
  redactionVersion: string;
  sentimentScore: number;
  aspects: CorpusAspect[];
  safetyFlag: boolean;
  safetyReasonCodes: string[];
  safetyConfidence: number | null;
  routeAction: RouteAction;
  modelVersion: string;
  classifierVersion: string;
  processingStatus: "routed";
  createdAt: string;
  anxietyPre: number | null;
  anxietyPost: number | null;
  anxietyPairValid: boolean;
  comprehensionApplicable: boolean;
  understoodWithoutSearch: boolean | null;
  disclaimerExposed: boolean;
  disclaimerPolarity: number | null;
  bucketId: BucketQuota["id"];
}

export interface CorpusTicket {
  ticketId: string;
  responseId: string | null;
  sessionId: string;
  ticketType: "p0_clinical" | "customer_success";
  status: "open" | "contacted" | "resolved";
  priority: "p0" | "standard";
  ownerTeam: string;
  ownerId: string;
  createdAt: string;
  firstContactAt: string | null;
  resolvedAt: string | null;
  slaDueAt: string;
  slaBreachedAt: string | null;
  resolutionCode: string | null;
  lastUpdatedBy: string;
  version: number;
  updatedAt: string;
  bucketId: BucketQuota["id"];
}

export interface CorpusPage {
  pageEventId: string;
  ticketId: string;
  delivered: boolean;
  sentAt: string;
  acknowledgedAt: string | null;
  detailCode: string;
  bucketId: BucketQuota["id"];
}

export interface CorpusAudit {
  auditId: string;
  responseId: string;
  stage: string;
  status: "passed" | "flagged" | "failed" | "completed";
  detailCodes: string[];
  occurredAt: string;
  requestId: string;
}

export interface CorpusQuarantine {
  quarantineId: string;
  occurredAt: string;
  stage: "leakage_scan";
  status: "failed";
  detailCodes: string[];
  bucketId: BucketQuota["id"];
}

export interface CorpusOverride {
  overrideId: string;
  featureKey: FeatureKey;
  aspect: AspectKey;
  critical: boolean;
  note: string;
}

export interface CorpusTelemetry {
  sessionId: string;
  device: "desktop" | "mobile" | "tablet";
  cohortKey: CohortKey;
  rageClicks: number;
  deadClicks: number;
  events: string[];
  linkedResponseId: string | null;
}

export interface Corpus {
  seed: number;
  cohorts: CorpusCohort[];
  sessions: CorpusSession[];
  invitations: CorpusInvitation[];
  responses: CorpusResponse[];
  tickets: CorpusTicket[];
  pages: CorpusPage[];
  audits: CorpusAudit[];
  quarantines: CorpusQuarantine[];
  overrides: CorpusOverride[];
  telemetry: CorpusTelemetry[];
}

const AUDIT_STAGES = [
  "ingress",
  "clinical_pre_check",
  "phi_redaction",
  "ner_redaction",
  "leakage_scan",
  "classification",
  "routing",
  "notification",
] as const;

const SAFE_ASPECTS: Record<FeatureKey, readonly [AspectKey, AspectKey]> = {
  lab_blood_parser: ["actionability", "response_speed"],
  mri_imaging_insights: ["actionability", "tone_and_bedside_manner"],
  symptom_chat_companion: ["tone_and_bedside_manner", "ui_confusion"],
  gp_question_builder: ["actionability", "response_speed"],
};

const SNIPPETS: Record<AspectKey, Record<-1 | 0 | 1, string>> = {
  clinical_trust: {
    "1": "The explanation matched what the clinician said afterwards.",
    "0": "The clinical detail was neither reassuring nor alarming.",
    "-1": "The summary conflicted with the clinician's reading.",
  },
  tone_and_bedside_manner: {
    "1": "The tone felt calm and kind.",
    "0": "The tone was plain and neutral.",
    "-1": "The tone felt cold and dismissive.",
  },
  document_parsing_ocr: {
    "1": "The scanned report was read cleanly.",
    "0": "The parse of the report was unremarkable.",
    "-1": "The parser failed on the second page of the report.",
  },
  actionability: {
    "1": "It gave a short list of questions for the consultant.",
    "0": "The next steps were listed without emphasis.",
    "-1": "It said to consult a doctor without explaining anything useful.",
  },
  billing_cost: {
    "1": "The price felt fair.",
    "0": "Billing was mentioned without a complaint.",
    "-1": "A billing charge showed up that was not expected.",
  },
  ui_confusion: {
    "1": "The screen was simple to navigate.",
    "0": "The layout was ordinary.",
    "-1": "It was hard to find where to upload the report.",
  },
  response_speed: {
    "1": "The reply arrived almost instantly.",
    "0": "The wait was ordinary.",
    "-1": "The reply felt slow.",
  },
};

const SAFETY_TEXT: Record<string, string> = {
  ocr_unit_mismatch: "The report mixed up mg/dL and mmol/L on the glucose reading, a wrong unit.",
  missed_abnormal_marker: "It missed an abnormal marker that the clinician flagged immediately.",
  contradicts_clinician: "The summary contradicted what the radiologist said directly.",
  false_reassurance: "It reassured the result was fine, but the clinician found something serious.",
  urgent_symptom_minimisation:
    "It said the chest pain was nothing, but the pain got worse overnight.",
  self_harm_or_emergency: "The note mentioned self-harm and the reply just moved on.",
  medication_danger: "It suggested a medication dose that was a wrong dosage.",
};

const cache = new Map<number, Corpus>();

export function buildCorpus(seed = DEFAULT_SEED): Corpus {
  const hit = cache.get(seed);
  if (hit) return hit;
  const corpus = assemble(seed);
  cache.set(seed, corpus);
  return corpus;
}

function assemble(seed: number): Corpus {
  const cohorts = COHORTS.map((cohort) => ({
    userCohortId: stableId(seed, `cohort:${cohort.cohortKey}`, 0),
    cohortKey: cohort.cohortKey,
    cohortName: cohort.cohortName,
    tenureBand: cohort.tenureBand,
    planType: cohort.planType,
    isActive: true,
  }));
  const cohortIdByKey = new Map(cohorts.map((cohort) => [cohort.cohortKey, cohort.userCohortId]));
  const actorId = stableId(seed, "actor", 0);

  const sessions: CorpusSession[] = [];
  const invitations: CorpusInvitation[] = [];
  const responses: CorpusResponse[] = [];
  const tickets: CorpusTicket[] = [];
  const pages: CorpusPage[] = [];
  const quarantines: CorpusQuarantine[] = [];

  for (const bucket of BUCKETS) {
    const built = buildBucket(seed, bucket, cohortIdByKey, actorId);
    sessions.push(...built.sessions);
    invitations.push(...built.invitations);
    responses.push(...built.responses);
    tickets.push(...built.tickets);
    pages.push(...built.pages);
    quarantines.push(...built.quarantines);
  }

  return {
    seed,
    cohorts,
    sessions,
    invitations,
    responses,
    tickets,
    pages,
    audits: buildAudits(seed, responses),
    quarantines,
    overrides: PINNED_THEMES.map((theme, index) => ({
      overrideId: stableId(seed, "override", index),
      featureKey: theme.featureKey,
      aspect: theme.aspect,
      critical: theme.critical,
      note: theme.note,
    })),
    telemetry: buildTelemetry(seed, responses),
  };
}

function buildBucket(
  seed: number,
  bucket: BucketQuota,
  cohortIdByKey: Map<CohortKey, string>,
  actorId: string,
) {
  const responses = draftResponses(seed, bucket, cohortIdByKey);
  applyInstruments(bucket, responses);
  applyAspects(responses);
  applyPins(bucket, responses);
  applySafety(bucket, responses);

  const sessions: CorpusSession[] = [];
  const invitations: CorpusInvitation[] = [];
  const sessionById = new Map<string, CorpusSession>();

  for (const response of responses) {
    const session: CorpusSession = {
      sessionId: response.sessionId,
      startedAt: response.receivedAt,
      featureKey: response.featureKey,
      userCohortId: response.userCohortId,
      eligibleClinical: response.featureKey !== "gp_question_builder",
      mismatchCodes: response.safetyReasonCodes.filter((code) =>
        (MISMATCH_CODES as readonly string[]).includes(code),
      ),
      harmCodes: response.safetyReasonCodes.filter((code) =>
        (HARM_CODES as readonly string[]).includes(code),
      ),
      bucketId: bucket.id,
    };
    sessions.push(session);
    sessionById.set(session.sessionId, session);
    invitations.push({
      invitationId: response.invitationId,
      sessionId: response.sessionId,
      deliveredAt: response.receivedAt,
      eligible: true,
      featureKey: response.featureKey,
      bucketId: bucket.id,
    });
  }

  const clinicalResponses = responses.filter(
    (response) => response.featureKey !== "gp_question_builder",
  ).length;
  const extraCount = bucket.clinicalSessions - clinicalResponses;
  const unanswered = bucket.eligibleInvitations - responses.length;
  const invitationSlots = unanswered + bucket.ineligibleInvitations;
  const clock = CLOCKS[bucket.id];
  const reservedForFlags = clock ? clock.sessionMismatch + clock.sessionHarm : 0;
  if (extraCount < reservedForFlags + invitationSlots) {
    throw new Error(
      `${bucket.id} has ${extraCount} extra clinical sessions for ${reservedForFlags + invitationSlots} flag and invitation slots`,
    );
  }

  for (let index = 0; index < extraCount; index++) {
    const sessionIndex = responses.length + index;
    const session: CorpusSession = {
      sessionId: stableId(seed, `session:${bucket.id}`, sessionIndex),
      startedAt: timestampIn(bucket.from, bucket.to, `extra:${bucket.id}:${index}`),
      featureKey: "lab_blood_parser",
      userCohortId: null,
      eligibleClinical: true,
      mismatchCodes: [],
      harmCodes: [],
      bucketId: bucket.id,
    };
    sessions.push(session);
    sessionById.set(session.sessionId, session);
  }

  if (clock) stampSessionFlags(clock, sessions.slice(responses.length));

  const extra = sessions.slice(responses.length);
  for (let index = 0; index < unanswered; index++) {
    const session = extra[reservedForFlags + index];
    if (!session) throw new Error(`Missing unanswered session in ${bucket.id}`);
    invitations.push({
      invitationId: stableId(seed, `invitation:${bucket.id}`, responses.length + index),
      sessionId: session.sessionId,
      deliveredAt: session.startedAt,
      eligible: true,
      featureKey: session.featureKey,
      bucketId: bucket.id,
    });
  }
  for (let index = 0; index < bucket.ineligibleInvitations; index++) {
    const session = extra[reservedForFlags + unanswered + index];
    if (!session) throw new Error(`Missing ineligible session in ${bucket.id}`);
    invitations.push({
      invitationId: stableId(
        seed,
        `invitation:${bucket.id}`,
        responses.length + unanswered + index,
      ),
      sessionId: session.sessionId,
      deliveredAt: session.startedAt,
      eligible: false,
      featureKey: session.featureKey,
      bucketId: bucket.id,
    });
  }

  const { tickets, pages } = buildTickets(seed, bucket, responses, sessions, sessionById, actorId);
  const quarantines = Array.from({ length: QUARANTINE_PER_BUCKET }, (_, index) => ({
    quarantineId: stableId(seed, `quarantine:${bucket.id}`, index),
    occurredAt: timestampIn(bucket.from, bucket.to, `quarantine:${bucket.id}:${index}`),
    stage: "leakage_scan" as const,
    status: "failed" as const,
    detailCodes: ["residual_mrn_pattern"],
    bucketId: bucket.id,
  }));

  return { sessions, invitations, responses, tickets, pages, quarantines };
}

function draftResponses(
  seed: number,
  bucket: BucketQuota,
  cohortIdByKey: Map<CohortKey, string>,
): CorpusResponse[] {
  const features = dealFeatures(bucket.responses, featureCounts(bucket.responses));
  const surveys = dealSurveys(bucket);
  const cohorts = assignCohorts(bucket, features);
  return features.map((featureKey, index) => {
    const survey = surveys[index];
    const cohortKey = cohorts[index];
    if (!survey || !cohortKey) throw new Error(`Slot ${index} missing in ${bucket.id}`);
    const receivedAt = timestampIn(bucket.from, bucket.to, `response:${bucket.id}:${index}`);
    const sessionId = stableId(seed, `session:${bucket.id}`, index);
    const invitationId = stableId(seed, `invitation:${bucket.id}`, index);
    const responseId = stableId(seed, `response:${bucket.id}`, index);
    return {
      responseId,
      externalResponseId: `synthetic-${responseId.slice(0, 8)}`,
      sourceSystem: "synthetic-fixture",
      receivedAt,
      surveyType: survey.surveyType,
      npsScore: survey.score,
      npsTier: survey.tier,
      featureKey,
      userCohortId: cohortIdByKey.get(cohortKey) ?? "",
      cohortKey,
      sessionId,
      invitationId,
      channel: "in_app",
      locale: "en-GB",
      responseEligible: true,
      verbatimRedacted: "",
      redactionTags: [],
      redactionCount: 0,
      redactionVersion: "deterministic-v1",
      sentimentScore: 0,
      aspects: [],
      safetyFlag: false,
      safetyReasonCodes: [],
      safetyConfidence: null,
      routeAction: routeFor(survey.tier, false),
      modelVersion: "ellyra-core-2026.5",
      classifierVersion: "synthetic-quota-v1",
      processingStatus: "routed",
      createdAt: receivedAt,
      anxietyPre: null,
      anxietyPost: null,
      anxietyPairValid: false,
      comprehensionApplicable: false,
      understoodWithoutSearch: null,
      disclaimerExposed: false,
      disclaimerPolarity: null,
      bucketId: bucket.id,
    };
  });
}

function dealFeatures(total: number, counts: Record<FeatureKey, number>): FeatureKey[] {
  const remaining = { ...counts };
  const keys = Object.keys(counts) as FeatureKey[];
  const out: FeatureKey[] = [];
  while (out.length < total) {
    for (const key of keys) {
      const left = remaining[key];
      if (left > 0) {
        out.push(key);
        remaining[key] = left - 1;
      }
    }
  }
  return out;
}

function dealSurveys(
  bucket: BucketQuota,
): Array<{ surveyType: SurveyType; tier: NpsTier; score: number }> {
  const slots: Array<{ surveyType: SurveyType; tier: NpsTier; score: number }> = [];
  pushTiers(slots, "relational", bucket.mix.relational);
  pushTiers(slots, "transactional", bucket.mix.transactional);
  if (slots.length !== bucket.responses) {
    throw new Error(`${bucket.id} produced ${slots.length} survey slots`);
  }
  return slots;
}

function pushTiers(
  slots: Array<{ surveyType: SurveyType; tier: NpsTier; score: number }>,
  surveyType: SurveyType,
  counts: TierCounts,
) {
  for (let index = 0; index < counts.promoters; index++) {
    slots.push({ surveyType, tier: "promoter", score: index % 2 === 0 ? 9 : 10 });
  }
  for (let index = 0; index < counts.passives; index++) {
    slots.push({ surveyType, tier: "passive", score: index % 2 === 0 ? 7 : 8 });
  }
  for (let index = 0; index < counts.detractors; index++) {
    slots.push({ surveyType, tier: "detractor", score: index % 7 });
  }
}

function assignCohorts(bucket: BucketQuota, features: FeatureKey[]): CohortKey[] {
  const cohorts: CohortKey[] = new Array(features.length);
  const keys = COHORTS.map((cohort) => cohort.cohortKey);
  const others = keys.filter((key) => key !== SUPPRESSION.cohortKey);
  const grouped = new Map<FeatureKey, number[]>();
  features.forEach((feature, index) => {
    const list = grouped.get(feature) ?? [];
    list.push(index);
    grouped.set(feature, list);
  });
  for (const [feature, indexes] of grouped) {
    const planted = bucket.id === SUPPRESSION.bucketId && feature === SUPPRESSION.featureKey;
    indexes.forEach((responseIndex, order) => {
      if (planted && order < SUPPRESSION.responses) {
        cohorts[responseIndex] = SUPPRESSION.cohortKey;
        return;
      }
      const key = planted
        ? others[(order - SUPPRESSION.responses) % others.length]
        : keys[order % keys.length];
      if (!key) throw new Error("Missing cohort key");
      cohorts[responseIndex] = key;
    });
  }
  if (cohorts.some((cohort) => cohort === undefined)) {
    throw new Error(`Cohort assignment left a gap in ${bucket.id}`);
  }
  return cohorts;
}

function applyInstruments(bucket: BucketQuota, responses: CorpusResponse[]) {
  const spec = bucket.id === "demo" ? "demo" : bucket.id === "prior" ? "prior" : null;
  if (!spec) return;
  const ard = ARD[spec];
  const ccs = CCS[spec];
  const dfi = DFI[spec];
  const lab = responses.filter((response) => response.featureKey === "lab_blood_parser");
  const imaging = responses.filter((response) => response.featureKey === "mri_imaging_insights");
  const chat = responses.filter((response) => response.featureKey === "symptom_chat_companion");
  const imagingPairs = spec === "demo" ? 300 : 300;
  const imagingImproved = spec === "demo" ? 180 : 160;
  const labPairs = spec === "demo" ? 400 : 400;
  const labImproved = spec === "demo" ? 360 : 360;
  const chatPairs = ard.pairs - imagingPairs - labPairs;
  const chatImproved = ard.improved - imagingImproved - labImproved;
  assignPairs(imaging, imagingPairs, imagingImproved);
  assignPairs(lab, labPairs, labImproved);
  assignPairs(chat, chatPairs, chatImproved);
  let incomplete = 0;
  for (const response of responses) {
    if (incomplete >= ard.incomplete) break;
    if (response.anxietyPre !== null) continue;
    response.anxietyPre = 6;
    response.anxietyPost = null;
    response.anxietyPairValid = false;
    incomplete += 1;
  }
  if (incomplete !== ard.incomplete) throw new Error(`${bucket.id} incomplete pairs ${incomplete}`);

  const labAnswers = ccs.answers - ccs.imagingAnswers;
  const labUnderstood = ccs.understood - ccs.imagingUnderstood;
  assignComprehension(lab, labAnswers, labUnderstood);
  assignComprehension(imaging, ccs.imagingAnswers, ccs.imagingUnderstood);

  for (let index = 0; index < dfi.exposed; index++) {
    const response = responses[index];
    if (!response) throw new Error(`${bucket.id} ran out of disclaimer rows`);
    response.disclaimerExposed = true;
    response.disclaimerPolarity = index < dfi.negative ? -1 : 1;
  }
}

function assignPairs(rows: CorpusResponse[], count: number, improved: number) {
  if (rows.length < count)
    throw new Error(`Need ${count} rows for anxiety pairs, have ${rows.length}`);
  for (let index = 0; index < count; index++) {
    const response = rows[index];
    if (!response) continue;
    response.anxietyPairValid = true;
    if (index < improved) {
      response.anxietyPre = 8;
      response.anxietyPost = 3;
    } else {
      response.anxietyPre = 4;
      response.anxietyPost = 6;
    }
  }
}

function assignComprehension(rows: CorpusResponse[], count: number, understood: number) {
  if (rows.length < count) {
    throw new Error(`Need ${count} comprehension rows, have ${rows.length}`);
  }
  for (let index = 0; index < count; index++) {
    const response = rows[index];
    if (!response) continue;
    response.comprehensionApplicable = true;
    response.understoodWithoutSearch = index < understood;
  }
}

function applyAspects(responses: CorpusResponse[]) {
  for (const response of responses) {
    const polarity: -1 | 0 | 1 =
      response.npsTier === "promoter" ? 1 : response.npsTier === "detractor" ? -1 : 0;
    const [first, second] = SAFE_ASPECTS[response.featureKey];
    response.aspects = [first, second].map((aspect) => ({
      aspect,
      polarity,
      confidence: 0.8,
    }));
    response.sentimentScore = polarity;
  }
}

function applyPins(bucket: BucketQuota, responses: CorpusResponse[]) {
  if (bucket.id !== "demo") return;
  for (const theme of PINNED_THEMES) {
    const matches = responses.filter((response) => response.featureKey === theme.featureKey);
    for (let index = 0; index < theme.demoMentions; index++) {
      const response = matches[index];
      if (!response) throw new Error(`Not enough rows to pin ${theme.note}`);
      response.aspects.push({ aspect: theme.aspect, polarity: -1, confidence: 0.9 });
    }
  }
  for (const response of responses) {
    if (response.aspects.length === 0) continue;
    const sum = response.aspects.reduce((total, aspect) => total + aspect.polarity, 0);
    response.sentimentScore = Number((sum / response.aspects.length).toFixed(3));
  }
}

function applySafety(bucket: BucketQuota, responses: CorpusResponse[]) {
  const clock = CLOCKS[bucket.id];
  if (!clock) return;
  const clinical = responses.filter((response) => response.featureKey !== "gp_question_builder");
  const detractors = clinical.filter((response) => response.npsTier === "detractor");
  const others = clinical.filter((response) => response.npsTier !== "detractor");
  const onDetractors = detractors.slice(0, clock.verbatimMismatchOnDetractors);
  const onOthers = others.slice(0, clock.verbatimMismatch - clock.verbatimMismatchOnDetractors);
  if (onDetractors.length !== clock.verbatimMismatchOnDetractors) {
    throw new Error(`${bucket.id} lacks detractor safety rows`);
  }
  if (onOthers.length !== clock.verbatimMismatch - clock.verbatimMismatchOnDetractors) {
    throw new Error(`${bucket.id} lacks non-detractor safety rows`);
  }
  [...onDetractors, ...onOthers].forEach((response, index) => {
    const code = MISMATCH_CODES[index % MISMATCH_CODES.length] ?? MISMATCH_CODES[0];
    response.safetyFlag = true;
    response.safetyReasonCodes = [code];
    response.safetyConfidence = 0.9;
    response.routeAction = "p0_clinical_page";
  });
}

function stampSessionFlags(clock: ClockQuota, extra: CorpusSession[]) {
  for (let index = 0; index < clock.sessionMismatch; index++) {
    const session = extra[index];
    const code = MISMATCH_CODES[index % MISMATCH_CODES.length];
    if (!session || !code) throw new Error("Missing session for a mismatch flag");
    session.mismatchCodes = [code];
  }
  for (let index = 0; index < clock.sessionHarm; index++) {
    const session = extra[clock.sessionMismatch + index];
    const code = HARM_CODES[index % HARM_CODES.length];
    if (!session || !code) throw new Error("Missing session for a harm flag");
    session.harmCodes = [code];
  }
}

function buildTickets(
  seed: number,
  bucket: BucketQuota,
  responses: CorpusResponse[],
  sessions: CorpusSession[],
  sessionById: Map<string, CorpusSession>,
  actorId: string,
) {
  const tickets: CorpusTicket[] = [];
  const pages: CorpusPage[] = [];
  const clock = CLOCKS[bucket.id];
  let ticketIndex = 0;

  const p0Units: Array<{
    session: CorpusSession;
    response: CorpusResponse | null;
    codes: string[];
  }> = [];
  for (const session of sessions) {
    if (session.bucketId !== bucket.id) continue;
    if (session.mismatchCodes.length === 0 && session.harmCodes.length === 0) continue;
    const response = responses.find((row) => row.sessionId === session.sessionId) ?? null;
    if (response) continue;
    p0Units.push({
      session,
      response: null,
      codes: [...session.mismatchCodes, ...session.harmCodes],
    });
  }
  for (const response of responses) {
    if (!response.safetyFlag) continue;
    const session = sessionById.get(response.sessionId);
    if (!session) throw new Error("Safety response is missing its session");
    p0Units.push({ session, response, codes: response.safetyReasonCodes });
  }

  if (clock) {
    const openAndLate = clock.p0Open + clock.p0Late;
    if (p0Units.length < openAndLate) throw new Error(`${bucket.id} P0 list is short`);
    p0Units.forEach((unit, index) => {
      const kind = index < clock.p0Open ? "open" : index < openAndLate ? "late" : "ontime";
      const createdAt =
        kind === "open"
          ? addSeconds(`${bucket.from}T00:00:00.000Z`, 3600)
          : timestampIn(bucket.from, bucket.to, `p0:${bucket.id}:${index}`);
      const delay = kind === "late" ? 1200 + index * 300 : kind === "ontime" ? 120 + index : null;
      const ticket = makeTicket(seed, bucket, ticketIndex, {
        responseId: unit.response?.responseId ?? null,
        sessionId: unit.session.sessionId,
        ticketType: "p0_clinical",
        priority: "p0",
        ownerTeam: "clinical_safety",
        createdAt,
        delaySeconds: delay,
        slaSeconds: 15 * 60,
        resolved: kind === "ontime",
        actorId,
        openPastDue: kind === "open",
      });
      tickets.push(ticket);
      const failed = index < clock.pageFailures;
      pages.push({
        pageEventId: stableId(seed, `page:${bucket.id}`, ticketIndex),
        ticketId: ticket.ticketId,
        delivered: !failed,
        sentAt: createdAt,
        acknowledgedAt: failed || kind === "open" ? null : ticket.firstContactAt,
        detailCode: failed ? "webhook_failed" : kind === "open" ? "awaiting_ack" : "acked",
        bucketId: bucket.id,
      });
      ticketIndex += 1;
    });
  }

  const cs = responses.filter(
    (response) => response.npsTier === "detractor" && !response.safetyFlag,
  );
  const resolvedCs = clock
    ? clock.resolvedTickets - tickets.filter((ticket) => ticket.status === "resolved").length
    : Math.round(cs.length * 0.7);
  if (resolvedCs < 0 || resolvedCs > cs.length) {
    throw new Error(`${bucket.id} CS resolved count ${resolvedCs} of ${cs.length}`);
  }
  const delays = bucket.id === "demo" ? demoCsDelays(cs.length) : cs.map(() => 14_400);
  cs.forEach((response, index) => {
    const delay = delays[index];
    if (delay === undefined) throw new Error("Missing CS delay");
    tickets.push(
      makeTicket(seed, bucket, ticketIndex, {
        responseId: response.responseId,
        sessionId: response.sessionId,
        ticketType: "customer_success",
        priority: "standard",
        ownerTeam: "customer_success",
        createdAt: response.receivedAt,
        delaySeconds: delay,
        slaSeconds: 24 * 60 * 60,
        resolved: index < resolvedCs,
        actorId,
        openPastDue: false,
      }),
    );
    ticketIndex += 1;
  });

  finishVerbatims(responses);
  return { tickets, pages };
}

function demoCsDelays(count: number): number[] {
  const medianIndex = 109;
  const within24h = 211;
  if (count !== 264) throw new Error(`Demo CS delays expect 264 tickets, got ${count}`);
  return Array.from({ length: count }, (_, index) => {
    if (index < medianIndex) return 1000 + index;
    if (index === medianIndex) return 11880;
    if (index < within24h) return 11881 + (index - medianIndex);
    return 86401 + (index - within24h);
  });
}

function makeTicket(
  seed: number,
  bucket: BucketQuota,
  index: number,
  input: {
    responseId: string | null;
    sessionId: string;
    ticketType: CorpusTicket["ticketType"];
    priority: CorpusTicket["priority"];
    ownerTeam: string;
    createdAt: string;
    delaySeconds: number | null;
    slaSeconds: number;
    resolved: boolean;
    actorId: string;
    openPastDue: boolean;
  },
): CorpusTicket {
  const slaDueAt = addSeconds(input.createdAt, input.slaSeconds);
  const firstContactAt =
    input.delaySeconds === null ? null : addSeconds(input.createdAt, input.delaySeconds);
  const breached =
    input.delaySeconds !== null ? input.delaySeconds > input.slaSeconds : input.openPastDue;
  const status = input.delaySeconds === null ? "open" : input.resolved ? "resolved" : "contacted";
  const resolvedAt =
    status === "resolved" && firstContactAt ? addSeconds(firstContactAt, 3600) : null;
  return {
    ticketId: stableId(seed, `ticket:${bucket.id}`, index),
    responseId: input.responseId,
    sessionId: input.sessionId,
    ticketType: input.ticketType,
    status,
    priority: input.priority,
    ownerTeam: input.ownerTeam,
    ownerId: input.actorId,
    createdAt: input.createdAt,
    firstContactAt,
    resolvedAt,
    slaDueAt,
    slaBreachedAt: breached ? slaDueAt : null,
    resolutionCode: status === "resolved" ? "explained_to_user" : null,
    lastUpdatedBy: input.actorId,
    version: status === "open" ? 0 : status === "contacted" ? 1 : 2,
    updatedAt: resolvedAt ?? firstContactAt ?? input.createdAt,
    bucketId: bucket.id,
  };
}

function finishVerbatims(responses: CorpusResponse[]) {
  responses.forEach((response, index) => {
    const sentences = response.aspects.map((aspect) => {
      const polarity = (aspect.polarity === 0 ? 0 : aspect.polarity > 0 ? 1 : -1) as -1 | 0 | 1;
      return SNIPPETS[aspect.aspect][polarity];
    });
    if (response.disclaimerPolarity !== null && response.disclaimerPolarity < 0) {
      sentences.unshift("The legal disclaimers were repetitive and defensive.");
    }
    for (const code of response.safetyReasonCodes) {
      const sentence = SAFETY_TEXT[code];
      if (sentence) sentences.unshift(sentence);
    }
    if (sentences.length === 0) sentences.push("No specific feedback provided.");
    if (index % 10 === 0) {
      sentences.push("Recorded for [NAME].");
      response.redactionTags = ["NAME"];
      response.redactionCount = 1;
    }
    response.verbatimRedacted = sentences.join(" ");
  });
}

function routeFor(tier: NpsTier, safety: boolean): RouteAction {
  if (safety) return "p0_clinical_page";
  if (tier === "detractor") return "cs_ticket";
  if (tier === "promoter") return "review_prompt";
  return "micro_poll";
}

function buildAudits(seed: number, responses: CorpusResponse[]): CorpusAudit[] {
  const audits: CorpusAudit[] = [];
  responses.forEach((response, responseIndex) => {
    AUDIT_STAGES.forEach((stage, stageIndex) => {
      const flagged = stage === "clinical_pre_check" && response.safetyFlag;
      audits.push({
        auditId: stableId(seed, "audit", responseIndex * AUDIT_STAGES.length + stageIndex),
        responseId: response.responseId,
        stage,
        status: stage === "routing" ? "completed" : flagged ? "flagged" : "passed",
        detailCodes:
          stage === "routing"
            ? [response.routeAction]
            : flagged
              ? response.safetyReasonCodes
              : stage === "leakage_scan"
                ? ["clean"]
                : [],
        occurredAt: response.receivedAt,
        requestId: stableId(seed, `request:${response.bucketId}`, responseIndex),
      });
    });
  });
  return audits;
}

/** Integer shares of `total` that follow `weights` and sum back to `total`. */
function largestRemainder(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / weightSum);
  const counts = exact.map((value) => Math.floor(value));
  let leftover = total - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of order) {
    if (leftover === 0) break;
    counts[entry.index] = (counts[entry.index] ?? 0) + 1;
    leftover -= 1;
  }
  return counts;
}

function buildTelemetry(seed: number, responses: CorpusResponse[]): CorpusTelemetry[] {
  const demoResponses = responses.filter((response) => response.bucketId === "demo");
  const cohortKeys = COHORTS.map((cohort) => cohort.cohortKey);
  const byCohort = new Map<CohortKey, CorpusResponse[]>(cohortKeys.map((key) => [key, []]));
  for (const response of demoResponses) byCohort.get(response.cohortKey)?.push(response);

  const devices: Array<{
    device: CorpusTelemetry["device"];
    count: number;
    frustrated: number;
  }> = [
    { device: "desktop", count: TELEMETRY.desktop, frustrated: TELEMETRY.desktopFrustrated },
    { device: "mobile", count: TELEMETRY.mobile, frustrated: TELEMETRY.mobileFrustrated },
    { device: "tablet", count: TELEMETRY.tablet, frustrated: TELEMETRY.tabletFrustrated },
  ];
  const completionsByDevice = largestRemainder(
    TELEMETRY.completed,
    devices.map((device) => device.count),
  );
  const cursor = new Map<CohortKey, number>(cohortKeys.map((key) => [key, 0]));
  const rows: CorpusTelemetry[] = [];
  let index = 0;

  devices.forEach((spec, deviceIndex) => {
    const perCohort = largestRemainder(
      completionsByDevice[deviceIndex] ?? 0,
      cohortKeys.map(() => 1),
    );
    const seen = new Map<CohortKey, number>(cohortKeys.map((key) => [key, 0]));
    for (let offset = 0; offset < spec.count; offset += 1) {
      const cohortKey = cohortKeys[offset % cohortKeys.length];
      if (!cohortKey) throw new Error("Missing telemetry cohort");
      const seenInCohort = seen.get(cohortKey) ?? 0;
      seen.set(cohortKey, seenInCohort + 1);
      const cohortIndex = offset % cohortKeys.length;
      const completed = seenInCohort < (perCohort[cohortIndex] ?? 0);
      const frustrated = offset < spec.frustrated;
      let link: CorpusResponse | undefined;
      if (completed) {
        const pool = byCohort.get(cohortKey) ?? [];
        const at = cursor.get(cohortKey) ?? 0;
        link = pool[at];
        if (!link) throw new Error(`Not enough ${cohortKey} responses for telemetry links`);
        cursor.set(cohortKey, at + 1);
      }
      rows.push({
        sessionId: link?.sessionId ?? stableId(seed, "telemetry", index),
        device: spec.device,
        cohortKey,
        rageClicks: frustrated && spec.device !== "tablet" ? 2 : 0,
        deadClicks: frustrated ? 1 : 0,
        events: [
          "session_started",
          "guidance_shown",
          "disclaimer_seen",
          "survey_offered",
          ...(link ? ["survey_completed"] : []),
        ],
        linkedResponseId: link?.responseId ?? null,
      });
      index += 1;
    }
  });

  if (rows.filter((row) => row.linkedResponseId).length !== TELEMETRY.completed) {
    throw new Error("Telemetry completions do not match the quota");
  }
  return rows;
}
