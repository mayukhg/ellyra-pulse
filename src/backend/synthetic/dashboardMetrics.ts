/**
 * Product metrics measured from the seeded quota corpus.
 * Windows are half-open [from, to) on the UTC date. The demo scorecard uses
 * 2026-08-22 ≤ day < 2026-09-21, whose equal-length predecessor is the prior bucket.
 */
import {
  ASPECT_TAXONOMY,
  CLINICAL_ASPECTS,
  FEATURE_TOUCHPOINTS,
  type AnalyticsFilters,
  type AspectKey,
  type AbsaRowDto,
  type ExecutiveMetricsResponse,
  type FeatureKey,
  type FeatureMetric,
  type MetricValue,
  type NpsDistribution,
  type QuadrantPointDto,
} from "../contracts";
import {
  buildCorpus,
  type Corpus,
  type CorpusInvitation,
  type CorpusResponse,
  type CorpusSession,
  type CorpusTicket,
} from "./buildCorpus";
import { BUCKETS, MISMATCH_CODES, npsOf, type BucketQuota } from "./quotas";

const PRIVACY_MIN = 20;

export const DEMO_FILTERS: AnalyticsFilters = {
  from: "2026-08-22",
  to: "2026-09-21",
  timezone: "UTC",
};

const FEATURE_NAME: Record<FeatureKey, string> = {
  lab_blood_parser: "Lab / Blood Report Parser",
  mri_imaging_insights: "MRI / Imaging Insights",
  symptom_chat_companion: "Symptom Chat Companion",
  gp_question_builder: "GP Question Builder",
};

const ASPECT_NAME: Record<AspectKey, string> = {
  clinical_trust: "Clinical Trust",
  tone_and_bedside_manner: "Tone & Bedside Manner",
  document_parsing_ocr: "Document Parsing / OCR Quality",
  actionability: "Actionability",
  billing_cost: "Billing / Cost",
  ui_confusion: "UI Confusion",
  response_speed: "Response Speed",
};

const TREND_MONTH: Record<BucketQuota["id"], string> = {
  mar: "Mar",
  apr: "Apr",
  may: "May",
  jun: "Jun",
  jul_early: "Jul",
  prior: "Aug",
  demo: "Sep",
};

const MISMATCH = new Set<string>(MISMATCH_CODES);

export function trustStatus(
  kind: "ard" | "ccs" | "hfr" | "dfi",
  value: number,
): "healthy" | "watch" | "alarm" {
  if (kind === "hfr") return value < 0.2 ? "healthy" : "alarm";
  if (kind === "ard") return value > 75 ? "healthy" : value >= 70 ? "watch" : "alarm";
  if (kind === "ccs") return value > 85 ? "healthy" : value >= 80 ? "watch" : "alarm";
  return value < 5 ? "healthy" : value <= 8 ? "watch" : "alarm";
}

export function deltaOf(current: number, previous: number | null, digits: number): number | null {
  if (previous === null) return null;
  return Number((current - previous).toFixed(digits));
}

function rate(numerator: number, denominator: number, digits: number): number | null {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(digits));
}

function inWindow(iso: string, from: string, to: string): boolean {
  const day = iso.slice(0, 10);
  return day >= from && day < to;
}

export function previousFilters(filters: AnalyticsFilters): AnalyticsFilters {
  const start = Date.parse(`${filters.from}T00:00:00.000Z`);
  const end = Date.parse(`${filters.to}T00:00:00.000Z`);
  const from = new Date(start - (end - start)).toISOString().slice(0, 10);
  return { ...filters, from, to: filters.from };
}

function distribution(rows: CorpusResponse[]): NpsDistribution {
  const promoters = rows.filter((row) => row.npsTier === "promoter").length;
  const passives = rows.filter((row) => row.npsTier === "passive").length;
  const detractors = rows.filter((row) => row.npsTier === "detractor").length;
  const total = rows.length || 1;
  return {
    promotersPct: Number(((promoters / total) * 100).toFixed(1)),
    passivesPct: Number(((passives / total) * 100).toFixed(1)),
    detractorsPct: Number(((detractors / total) * 100).toFixed(1)),
    promotersCount: promoters,
    passivesCount: passives,
    detractorsCount: detractors,
  };
}

function npsScore(rows: CorpusResponse[]): number {
  const promoters = rows.filter((row) => row.npsTier === "promoter").length;
  const detractors = rows.filter((row) => row.npsTier === "detractor").length;
  return npsOf(promoters, detractors, rows.length);
}

interface Indexes {
  sessionById: Map<string, CorpusSession>;
  cohortId: string | undefined;
}

function indexes(corpus: Corpus, filters: AnalyticsFilters): Indexes {
  return {
    sessionById: new Map(corpus.sessions.map((session) => [session.sessionId, session])),
    cohortId: filters.cohort
      ? corpus.cohorts.find((cohort) => cohort.cohortKey === filters.cohort)?.userCohortId
      : undefined,
  };
}

function responseMatches(row: CorpusResponse, filters: AnalyticsFilters, dated: boolean): boolean {
  if (dated && !inWindow(row.receivedAt, filters.from, filters.to)) return false;
  if (filters.surveyType && row.surveyType !== filters.surveyType) return false;
  if (filters.feature && row.featureKey !== filters.feature) return false;
  if (filters.cohort && row.cohortKey !== filters.cohort) return false;
  if (filters.aspect && !row.aspects.some((aspect) => aspect.aspect === filters.aspect))
    return false;
  return true;
}

function sessionMatches(
  session: CorpusSession,
  filters: AnalyticsFilters,
  lookup: Indexes,
  dated: boolean,
): boolean {
  if (dated && !inWindow(session.startedAt, filters.from, filters.to)) return false;
  if (filters.feature && session.featureKey !== filters.feature) return false;
  if (filters.cohort && session.userCohortId !== lookup.cohortId) return false;
  return true;
}

function invitationMatches(
  invitation: CorpusInvitation,
  filters: AnalyticsFilters,
  lookup: Indexes,
): boolean {
  if (!inWindow(invitation.deliveredAt, filters.from, filters.to)) return false;
  if (filters.feature && invitation.featureKey !== filters.feature) return false;
  if (filters.cohort) {
    const session = lookup.sessionById.get(invitation.sessionId);
    if (!session || session.userCohortId !== lookup.cohortId) return false;
  }
  return true;
}

function ticketMatches(ticket: CorpusTicket, filters: AnalyticsFilters, lookup: Indexes): boolean {
  if (!inWindow(ticket.createdAt, filters.from, filters.to)) return false;
  if (!filters.feature && !filters.cohort) return true;
  const session = lookup.sessionById.get(ticket.sessionId);
  if (!session) return false;
  if (filters.feature && session.featureKey !== filters.feature) return false;
  if (filters.cohort && session.userCohortId !== lookup.cohortId) return false;
  return true;
}

function responsesOf(corpus: Corpus, filters: AnalyticsFilters, dated = true): CorpusResponse[] {
  return corpus.responses.filter((row) => responseMatches(row, filters, dated));
}

interface TrustCounts {
  pairs: number;
  improved: number;
  comprehensionAnswers: number;
  understood: number;
  exposed: number;
  disclaimerNegative: number;
  eligibleSessions: number;
  mismatchSessions: number;
  responses: number;
  eligibleInvitations: number;
}

function trustCounts(corpus: Corpus, filters: AnalyticsFilters): TrustCounts {
  const lookup = indexes(corpus, filters);
  const responses = responsesOf(corpus, filters);
  let pairs = 0;
  let improved = 0;
  let comprehensionAnswers = 0;
  let understood = 0;
  let exposed = 0;
  let disclaimerNegative = 0;
  for (const row of responses) {
    if (row.anxietyPairValid) {
      pairs += 1;
      if (row.anxietyPre !== null && row.anxietyPost !== null && row.anxietyPost < row.anxietyPre) {
        improved += 1;
      }
    }
    if (row.comprehensionApplicable) {
      comprehensionAnswers += 1;
      if (row.understoodWithoutSearch) understood += 1;
    }
    if (row.disclaimerExposed) {
      exposed += 1;
      if (row.disclaimerPolarity !== null && row.disclaimerPolarity < 0) disclaimerNegative += 1;
    }
  }
  let eligibleSessions = 0;
  let mismatchSessions = 0;
  for (const session of corpus.sessions) {
    if (!sessionMatches(session, filters, lookup, true)) continue;
    if (!session.eligibleClinical) continue;
    eligibleSessions += 1;
    if (session.mismatchCodes.some((code) => MISMATCH.has(code))) mismatchSessions += 1;
  }
  let eligibleInvitations = 0;
  for (const invitation of corpus.invitations) {
    if (!invitationMatches(invitation, filters, lookup)) continue;
    if (invitation.eligible) eligibleInvitations += 1;
  }
  return {
    pairs,
    improved,
    comprehensionAnswers,
    understood,
    exposed,
    disclaimerNegative,
    eligibleSessions,
    mismatchSessions,
    responses: responses.length,
    eligibleInvitations,
  };
}

function metric(
  value: number,
  previous: number | null,
  digits: number,
  extra: Partial<MetricValue> = {},
): MetricValue {
  return {
    value,
    previousValue: previous,
    delta: deltaOf(value, previous, digits),
    ...extra,
  };
}

function npsMetric(current: CorpusResponse[], previous: CorpusResponse[]): MetricValue {
  const value = npsScore(current);
  const previousValue = previous.length === 0 ? null : npsScore(previous);
  return metric(value, previousValue, 0);
}

export function corpusHallucinationByModel(
  corpus: Corpus,
  filters: AnalyticsFilters,
): ExecutiveMetricsResponse["hallucinationByModel"] {
  const lookup = indexes(corpus, filters);
  const groups = new Map<string, { eligible: number; mismatch: number }>();
  for (const session of corpus.sessions) {
    if (!sessionMatches(session, filters, lookup, true) || !session.eligibleClinical) continue;
    const group = groups.get(session.modelVersion) ?? { eligible: 0, mismatch: 0 };
    group.eligible += 1;
    if (session.mismatchCodes.some((code) => MISMATCH.has(code))) group.mismatch += 1;
    groups.set(session.modelVersion, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelVersion, group]) => {
      const value = rate(group.mismatch, group.eligible, 2) ?? 0;
      return {
        modelVersion,
        value,
        numerator: group.mismatch,
        denominator: group.eligible,
        status: trustStatus("hfr", value),
      };
    });
}

export function corpusExecutive(
  corpus: Corpus,
  filters: AnalyticsFilters,
): ExecutiveMetricsResponse {
  const priorFilters = previousFilters(filters);
  const rows = responsesOf(corpus, filters);
  const priorRows = responsesOf(corpus, priorFilters);
  const currentTrust = trustCounts(corpus, filters);
  const priorTrust = trustCounts(corpus, priorFilters);
  const dist = distribution(rows);
  const responseRate = rate(currentTrust.responses, currentTrust.eligibleInvitations, 1) ?? 0;
  const priorResponseRate = rate(priorTrust.responses, priorTrust.eligibleInvitations, 1);
  const ard = rate(currentTrust.improved, currentTrust.pairs, 1) ?? 0;
  const priorArd = rate(priorTrust.improved, priorTrust.pairs, 1);
  const ccs = rate(currentTrust.understood, currentTrust.comprehensionAnswers, 1) ?? 0;
  const priorCcs = rate(priorTrust.understood, priorTrust.comprehensionAnswers, 1);
  const hfr = rate(currentTrust.mismatchSessions, currentTrust.eligibleSessions, 2) ?? 0;
  const priorHfr = rate(priorTrust.mismatchSessions, priorTrust.eligibleSessions, 2);
  const dfi = rate(currentTrust.disclaimerNegative, currentTrust.exposed, 1) ?? 0;
  const priorDfi = rate(priorTrust.disclaimerNegative, priorTrust.exposed, 1);
  const closed = closedLoop(corpus, filters);
  const priorClosed = closedLoop(corpus, priorFilters);

  return {
    generatedAt: new Date().toISOString(),
    period: { from: filters.from, to: filters.to, timezone: filters.timezone },
    sample: {
      responses: rows.length,
      eligibleSurveys: currentTrust.eligibleInvitations,
      suppressed: rows.length < PRIVACY_MIN,
    },
    hallucinationByModel: corpusHallucinationByModel(corpus, filters),
    nps: {
      overall: npsMetric(rows, priorRows),
      relational: npsMetric(
        rows.filter((row) => row.surveyType === "relational"),
        priorRows.filter((row) => row.surveyType === "relational"),
      ),
      transactional: npsMetric(
        rows.filter((row) => row.surveyType === "transactional"),
        priorRows.filter((row) => row.surveyType === "transactional"),
      ),
      responseRate: metric(responseRate, priorResponseRate, 1, {
        numerator: currentTrust.responses,
        denominator: currentTrust.eligibleInvitations,
      }),
      distribution: dist,
      trend: corpusTrend(corpus, filters),
    },
    medicalTrust: {
      anxietyReductionDelta: metric(ard, priorArd, 1, {
        numerator: currentTrust.improved,
        denominator: currentTrust.pairs,
        status: trustStatus("ard", ard),
        target: { operator: "gt", value: 75 },
      }),
      clinicalComprehensionScore: metric(ccs, priorCcs, 1, {
        numerator: currentTrust.understood,
        denominator: currentTrust.comprehensionAnswers,
        status: trustStatus("ccs", ccs),
        target: { operator: "gt", value: 85 },
      }),
      hallucinationFlagRate: metric(hfr, priorHfr, 2, {
        numerator: currentTrust.mismatchSessions,
        denominator: currentTrust.eligibleSessions,
        status: trustStatus("hfr", hfr),
        target: { operator: "lt", value: 0.2 },
      }),
      disclaimerFatigueIndex: metric(dfi, priorDfi, 1, {
        numerator: currentTrust.disclaimerNegative,
        denominator: currentTrust.exposed,
        status: trustStatus("dfi", dfi),
        target: { operator: "lt", value: 5 },
      }),
    },
    closedLoop: {
      medianTimeToFirstContactSeconds: closed.medianSeconds,
      closeRate: metric(
        closed.closeRate,
        priorClosed.tickets === 0 ? null : priorClosed.closeRate,
        1,
      ),
      openP0Count: closed.openP0,
    },
  };
}

export function corpusTrend(corpus: Corpus, filters: AnalyticsFilters) {
  return BUCKETS.filter((bucket) => bucket.to > filters.from && bucket.from < filters.to).map(
    (bucket) => {
      const rows = corpus.responses.filter(
        (row) => row.bucketId === bucket.id && responseMatches(row, filters, false),
      );
      return {
        period: TREND_MONTH[bucket.id],
        relational: npsScore(rows.filter((row) => row.surveyType === "relational")),
        transactional: npsScore(rows.filter((row) => row.surveyType === "transactional")),
      };
    },
  );
}

export function corpusHistoryTrend(corpus: Corpus, filters: AnalyticsFilters) {
  const open: AnalyticsFilters = { ...filters, from: "2000-01-01", to: "2100-01-01" };
  return corpusTrend(corpus, open);
}

interface ClosedLoopSnapshot {
  medianSeconds: number | null;
  closeRate: number;
  tickets: number;
  resolved: number;
  openP0: number;
  p0Count: number;
  p0OnTime: number;
  p0Within15Pct: number | null;
  csCount: number;
  csOnTime: number;
  detractorWithin24Pct: number | null;
  phiLeaks: number;
  quarantines: number;
}

function contactSeconds(ticket: CorpusTicket): number | null {
  if (!ticket.firstContactAt) return null;
  return (Date.parse(ticket.firstContactAt) - Date.parse(ticket.createdAt)) / 1000;
}

function closedLoop(corpus: Corpus, filters: AnalyticsFilters): ClosedLoopSnapshot {
  const lookup = indexes(corpus, filters);
  const tickets = corpus.tickets.filter((ticket) => ticketMatches(ticket, filters, lookup));
  const contacts = tickets
    .map(contactSeconds)
    .filter((seconds): seconds is number => seconds !== null)
    .sort((a, b) => a - b);
  const medianSeconds = contacts.length
    ? (contacts[Math.floor(contacts.length / 2)] ?? null)
    : null;
  const resolved = tickets.filter((ticket) => ticket.status === "resolved").length;
  const p0 = tickets.filter((ticket) => ticket.priority === "p0");
  const p0OnTime = p0.filter((ticket) => {
    const seconds = contactSeconds(ticket);
    return seconds !== null && seconds <= 15 * 60;
  }).length;
  const cs = tickets.filter((ticket) => ticket.ticketType === "customer_success");
  const csOnTime = cs.filter((ticket) => {
    const seconds = contactSeconds(ticket);
    return seconds !== null && seconds <= 24 * 60 * 60;
  }).length;
  const responseIds = new Set(responsesOf(corpus, filters).map((row) => row.responseId));
  const phiLeaks = corpus.audits.filter(
    (audit) =>
      audit.stage === "leakage_scan" &&
      audit.status === "failed" &&
      responseIds.has(audit.responseId),
  ).length;
  const quarantines = corpus.quarantines.filter((row) =>
    inWindow(row.occurredAt, filters.from, filters.to),
  ).length;
  return {
    medianSeconds,
    closeRate: tickets.length ? Number(((resolved / tickets.length) * 100).toFixed(1)) : 0,
    tickets: tickets.length,
    resolved,
    openP0: p0.filter((ticket) => ticket.status === "open").length,
    p0Count: p0.length,
    p0OnTime,
    p0Within15Pct: p0.length ? Number(((p0OnTime / p0.length) * 100).toFixed(1)) : null,
    csCount: cs.length,
    csOnTime,
    detractorWithin24Pct: cs.length ? Math.round((csOnTime / cs.length) * 100) : null,
    phiLeaks,
    quarantines,
  };
}

export interface FunnelStep {
  step: string;
  label: string;
  count: number;
  drop: number;
}

export interface FunnelCohort {
  cohortKey: string;
  cohortName: string;
  steps: FunnelStep[];
}

const FUNNEL_STEPS: Array<{ step: string; label: string }> = [
  { step: "session_started", label: "Started" },
  { step: "guidance_shown", label: "Guidance" },
  { step: "disclaimer_seen", label: "Disclaimer" },
  { step: "survey_offered", label: "Offered" },
  { step: "survey_completed", label: "Completed" },
];

function funnelFor(sessions: Corpus["telemetry"]): FunnelStep[] {
  let previous = 0;
  return FUNNEL_STEPS.map((step, index) => {
    const count = sessions.filter((session) => session.events.includes(step.step)).length;
    const drop = index === 0 ? 0 : previous - count;
    previous = count;
    return { step: step.step, label: step.label, count, drop };
  });
}

export interface OperationsSnapshot extends ClosedLoopSnapshot {
  previousMedianSeconds: number | null;
  closeRateDelta: number | null;
  frustration: { overall: number; desktop: number; mobile: number; tablet: number };
  funnelCompletion: number;
  funnel: FunnelStep[];
  funnelByCohort: FunnelCohort[];
}

export function corpusOperations(corpus: Corpus, filters: AnalyticsFilters): OperationsSnapshot {
  const current = closedLoop(corpus, filters);
  const prior = closedLoop(corpus, previousFilters(filters));
  const frustrated = (device?: Corpus["telemetry"][number]["device"]) => {
    const rows = device
      ? corpus.telemetry.filter((session) => session.device === device)
      : corpus.telemetry;
    const hits = rows.filter((session) => session.rageClicks > 0 || session.deadClicks > 0).length;
    return rate(hits, rows.length, 1) ?? 0;
  };
  const started = corpus.telemetry.filter((session) =>
    session.events.includes("session_started"),
  ).length;
  const completed = corpus.telemetry.filter((session) =>
    session.events.includes("survey_completed"),
  ).length;
  return {
    ...current,
    previousMedianSeconds: prior.medianSeconds,
    closeRateDelta: prior.tickets === 0 ? null : deltaOf(current.closeRate, prior.closeRate, 1),
    frustration: {
      overall: frustrated(),
      desktop: frustrated("desktop"),
      mobile: frustrated("mobile"),
      tablet: frustrated("tablet"),
    },
    funnelCompletion: rate(completed, started, 1) ?? 0,
    funnel: funnelFor(corpus.telemetry),
    funnelByCohort: corpus.cohorts.map((cohort) => ({
      cohortKey: cohort.cohortKey,
      cohortName: cohort.cohortName,
      steps: funnelFor(
        corpus.telemetry.filter((session) => session.cohortKey === cohort.cohortKey),
      ),
    })),
  };
}

export function corpusFeatures(corpus: Corpus, filters: AnalyticsFilters): FeatureMetric[] {
  const priorFilters = previousFilters(filters);
  const rows = responsesOf(corpus, filters);
  const priorRows = responsesOf(corpus, priorFilters);
  return FEATURE_TOUCHPOINTS.map((featureKey): FeatureMetric => {
    const featureRows = rows.filter((row) => row.featureKey === featureKey);
    const previous = priorRows.filter((row) => row.featureKey === featureKey);
    const aspectImpact = new Map<AspectKey, number>();
    for (const row of featureRows) {
      for (const aspect of row.aspects) {
        aspectImpact.set(aspect.aspect, (aspectImpact.get(aspect.aspect) ?? 0) + aspect.polarity);
      }
    }
    let topDriver: FeatureMetric["topDriver"] = null;
    for (const [aspect, impact] of aspectImpact) {
      if (!topDriver || Math.abs(impact) > Math.abs(topDriver.impact)) {
        topDriver = {
          aspect,
          label: ASPECT_NAME[aspect],
          impact: Number(impact.toFixed(2)),
        };
      }
    }
    return {
      featureKey,
      featureName: FEATURE_NAME[featureKey],
      nps: npsScore(featureRows),
      monthOverMonthDelta:
        previous.length === 0 ? null : npsScore(featureRows) - npsScore(previous),
      responseCount: featureRows.length,
      distribution: distribution(featureRows),
      topDriver,
      safetyFlagCount: featureRows.filter((row) => row.safetyFlag).length,
    };
  }).sort((a, b) => b.responseCount - a.responseCount);
}

export function corpusQuadrant(
  corpus: Corpus,
  filters: AnalyticsFilters,
  minVolume: number,
  criticalOnly?: boolean,
): QuadrantPointDto[] {
  const rows = responsesOf(corpus, filters);
  const points: QuadrantPointDto[] = [];
  for (const featureKey of FEATURE_TOUCHPOINTS) {
    for (const aspect of ASPECT_TAXONOMY) {
      const mentions = rows.filter(
        (row) =>
          row.featureKey === featureKey && row.aspects.some((item) => item.aspect === aspect),
      );
      if (mentions.length === 0) continue;
      const net = mentions.reduce((sum, row) => {
        const tagged = row.aspects.find((item) => item.aspect === aspect);
        return sum + (tagged?.polarity ?? 0);
      }, 0);
      const override = corpus.overrides.find(
        (item) => item.featureKey === featureKey && item.aspect === aspect,
      );
      const critical = override?.critical === true;
      if (mentions.length < minVolume && !critical) continue;
      if (criticalOnly && !critical) continue;
      points.push({
        id: `${featureKey}:${aspect}`,
        theme: override?.note ?? `${FEATURE_NAME[featureKey]} · ${ASPECT_NAME[aspect]}`,
        featureKey,
        aspect,
        volume: mentions.length,
        netSentimentImpact: Number(net.toFixed(2)),
        critical,
        note: override?.note
          ? override.note
          : critical
            ? "Low volume, high impact — route to safety review."
            : `${ASPECT_NAME[aspect]} across ${FEATURE_NAME[featureKey]}.`,
      });
    }
  }
  return points;
}

export function corpusAbsa(corpus: Corpus, filters: AnalyticsFilters): AbsaRowDto[] {
  const rows = responsesOf(corpus, filters);
  return ASPECT_TAXONOMY.flatMap((aspect) => {
    const mentions = rows.flatMap((row) => row.aspects.filter((item) => item.aspect === aspect));
    if (mentions.length === 0) return [];
    const positive = mentions.filter((item) => item.polarity > 0).length;
    const negative = mentions.filter((item) => item.polarity < 0).length;
    const neutral = mentions.length - positive - negative;
    return [
      {
        aspect,
        category: CLINICAL_ASPECTS.has(aspect) ? ("clinical" as const) : ("operational" as const),
        mentions: mentions.length,
        positivePct: Number(((positive / mentions.length) * 100).toFixed(1)),
        neutralPct: Number(((neutral / mentions.length) * 100).toFixed(1)),
        negativePct: Number(((negative / mentions.length) * 100).toFixed(1)),
      },
    ];
  });
}

export function loadDashboard(filters: AnalyticsFilters = DEMO_FILTERS) {
  const corpus = buildCorpus();
  return {
    executive: corpusExecutive(corpus, filters),
    features: corpusFeatures(corpus, filters),
    quadrant: corpusQuadrant(corpus, filters, 0),
    absa: corpusAbsa(corpus, filters),
    operations: corpusOperations(corpus, filters),
    trend: corpusHistoryTrend(corpus, filters),
  };
}
