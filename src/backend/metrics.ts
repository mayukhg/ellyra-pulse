/**
 * Aggregation queries backing §5.1–§5.4. Operates over the in-memory store (src/server/store.ts)
 * with the same shape a real SQL implementation would return, so swapping the store for
 * Postgres later shouldn't require changing the route handlers.
 */
import {
  ASPECT_TAXONOMY,
  CLINICAL_ASPECTS,
  type AnalyticsFilters,
  type AbsaRowDto,
  type ExecutiveMetricsResponse,
  type FeatureMetric,
  type NpsDistribution,
  type QuadrantPointDto,
} from "./contracts";
import { store, type NpsResponseRow } from "./store";

const PRIVACY_MIN_COHORT_SIZE = 20;
const QUADRANT_HIGH_VOLUME = 300;
const QUADRANT_HIGH_IMPACT = 4;

function inRange(row: NpsResponseRow, filters: AnalyticsFilters): boolean {
  const receivedAt = row.receivedAt.slice(0, 10);
  if (receivedAt < filters.from || receivedAt >= filters.to) return false;
  if (filters.surveyType && row.surveyType !== filters.surveyType) return false;
  if (filters.feature && store.featureByKey(filters.feature)?.featureTouchpointId !== row.featureTouchpointId) {
    return false;
  }
  if (filters.aspect && !row.aspects.some((a) => a.aspect === filters.aspect)) return false;
  return true;
}

function distribution(rows: NpsResponseRow[]): NpsDistribution {
  const promoters = rows.filter((r) => r.npsTier === "promoter").length;
  const passives = rows.filter((r) => r.npsTier === "passive").length;
  const detractors = rows.filter((r) => r.npsTier === "detractor").length;
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

function npsScore(rows: NpsResponseRow[]): number {
  if (rows.length === 0) return 0;
  const d = distribution(rows);
  return Math.round(d.promotersPct - d.detractorsPct);
}

export function getExecutiveMetrics(filters: AnalyticsFilters): ExecutiveMetricsResponse {
  const rows = store.responses.filter((r) => inRange(r, filters));
  const eligible = rows.filter((r) => r.responseEligible);
  const relationalRows = rows.filter((r) => r.surveyType === "relational");
  const transactionalRows = rows.filter((r) => r.surveyType === "transactional");

  const openTickets = store.tickets.filter((t) => t.status !== "resolved");
  const openP0Count = openTickets.filter((t) => t.priority === "p0").length;

  const closedThisPeriod = store.tickets.filter((t) => t.createdAt.slice(0, 10) >= filters.from);
  const resolved = closedThisPeriod.filter((t) => t.status === "resolved");
  const closeRateValue = closedThisPeriod.length
    ? Number(((resolved.length / closedThisPeriod.length) * 100).toFixed(1))
    : 0;

  const contactedTickets = store.tickets.filter((t) => t.firstContactAt);
  const contactSeconds = contactedTickets
    .map((t) => (new Date(t.firstContactAt!).getTime() - new Date(t.createdAt).getTime()) / 1000)
    .sort((a, b) => a - b);
  const medianTimeToFirstContactSeconds = contactSeconds.length
    ? contactSeconds[Math.floor(contactSeconds.length / 2)]
    : null;

  return {
    generatedAt: new Date().toISOString(),
    period: { from: filters.from, to: filters.to, timezone: filters.timezone },
    sample: { responses: rows.length, eligibleSurveys: eligible.length, suppressed: rows.length < PRIVACY_MIN_COHORT_SIZE },
    nps: {
      overall: { value: npsScore(rows), previousValue: null, delta: null },
      relational: { value: npsScore(relationalRows), previousValue: null, delta: null },
      transactional: { value: npsScore(transactionalRows), previousValue: null, delta: null },
      responseRate: {
        value: eligible.length ? Number(((rows.length / eligible.length) * 100).toFixed(1)) : 0,
        previousValue: null,
        delta: null,
        numerator: rows.length,
        denominator: eligible.length,
      },
      distribution: distribution(rows),
      trend: [], // TODO: bucket by period once historical data spans more than one window
    },
    medicalTrust: {
      // TODO: wire real ARD/CCS pairing once the pre/post-anxiety and comprehension survey
      // fields land in fact_nps_response; placeholders keep the response shape stable.
      anxietyReductionDelta: { value: 0, previousValue: null, delta: null, target: { operator: "gt", value: 75 } },
      clinicalComprehensionScore: {
        value: 0,
        previousValue: null,
        delta: null,
        target: { operator: "gt", value: 85 },
      },
      hallucinationFlagRate: {
        value: rows.length
          ? Number(
              ((rows.filter((r) => r.safetyReasonCodes.includes("contradicts_clinician")).length / rows.length) * 100).toFixed(2),
            )
          : 0,
        previousValue: null,
        delta: null,
        target: { operator: "lt", value: 0.2 },
      },
      disclaimerFatigueIndex: { value: 0, previousValue: null, delta: null, target: { operator: "lt", value: 5 } },
    },
    closedLoop: {
      medianTimeToFirstContactSeconds,
      closeRate: { value: closeRateValue, previousValue: null, delta: null },
      openP0Count,
    },
  };
}

export function getFeatureMetrics(filters: AnalyticsFilters): FeatureMetric[] {
  const rows = store.responses.filter((r) => inRange(r, filters));

  return store.featureTouchpoints
    .map((feature): FeatureMetric => {
      const featureRows = rows.filter((r) => r.featureTouchpointId === feature.featureTouchpointId);
      const dist = distribution(featureRows);

      const aspectImpact = new Map<string, { count: number; impact: number }>();
      for (const row of featureRows) {
        for (const a of row.aspects) {
          const entry = aspectImpact.get(a.aspect) ?? { count: 0, impact: 0 };
          entry.count += 1;
          entry.impact += Math.abs(a.polarity);
          aspectImpact.set(a.aspect, entry);
        }
      }
      let topDriver: FeatureMetric["topDriver"] = null;
      for (const [aspect, { count, impact }] of aspectImpact) {
        if (!topDriver || impact > topDriver.impact) {
          topDriver = { aspect, label: aspect.replace(/_/g, " "), impact: Number(impact.toFixed(2)) };
        }
        void count;
      }

      return {
        featureKey: feature.featureKey,
        featureName: feature.featureName,
        nps: npsScore(featureRows),
        monthOverMonthDelta: null,
        responseCount: featureRows.length,
        distribution: dist,
        topDriver,
        safetyFlagCount: featureRows.filter((r) => r.safetyFlag).length,
      };
    })
    .sort((a, b) => b.responseCount - a.responseCount);
}

export function getQuadrant(filters: AnalyticsFilters, minVolume: number, criticalOnly?: boolean): QuadrantPointDto[] {
  const rows = store.responses.filter((r) => inRange(r, filters));
  const points: QuadrantPointDto[] = [];

  for (const feature of store.featureTouchpoints) {
    for (const aspect of ASPECT_TAXONOMY) {
      const matching = rows.filter(
        (r) => r.featureTouchpointId === feature.featureTouchpointId && r.aspects.some((a) => a.aspect === aspect),
      );
      if (matching.length === 0) continue;

      const negativeImpact = matching
        .flatMap((r) => r.aspects.filter((a) => a.aspect === aspect))
        .reduce((sum, a) => sum + Math.max(0, -a.polarity), 0);

      const critical =
        matching.length < QUADRANT_HIGH_VOLUME &&
        negativeImpact >= QUADRANT_HIGH_IMPACT &&
        CLINICAL_ASPECTS.has(aspect);

      // Safety-critical themes are never dropped by minVolume, per §5.3.
      if (matching.length < minVolume && !critical) continue;
      if (criticalOnly && !critical) continue;

      points.push({
        id: `${feature.featureKey}:${aspect}`,
        theme: aspect.replace(/_/g, " "),
        featureKey: feature.featureKey,
        aspect,
        volume: matching.length,
        netSentimentImpact: Number(negativeImpact.toFixed(2)),
        critical,
        note: critical ? "Low volume, high impact — route to safety review." : "",
      });
    }
  }
  return points;
}

export function getAbsaRows(filters: AnalyticsFilters): AbsaRowDto[] {
  const rows = store.responses.filter((r) => inRange(r, filters));

  return ASPECT_TAXONOMY.map((aspect): AbsaRowDto | null => {
    const mentions = rows.flatMap((r) => r.aspects.filter((a) => a.aspect === aspect));
    if (mentions.length === 0) return null;

    const positive = mentions.filter((m) => m.polarity > 0).length;
    const negative = mentions.filter((m) => m.polarity < 0).length;
    const neutral = mentions.length - positive - negative;

    return {
      aspect: aspect.replace(/_/g, " "),
      category: CLINICAL_ASPECTS.has(aspect) ? "clinical" : "operational",
      mentions: mentions.length,
      positivePct: Number(((positive / mentions.length) * 100).toFixed(1)),
      neutralPct: Number(((neutral / mentions.length) * 100).toFixed(1)),
      negativePct: Number(((negative / mentions.length) * 100).toFixed(1)),
    };
  }).filter((row): row is AbsaRowDto => row !== null);
}
