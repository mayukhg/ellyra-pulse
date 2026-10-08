/**
 * Real Postgres Repository implementation against the schema in db/migrations/0001_init.sql.
 * Selected when DATABASE_URL is set (src/backend/repositories/index.ts).
 */
import type { Pool } from "pg";
import {
  CLINICAL_ASPECTS,
  type AspectKey,
  type AnalyticsFilters,
  type AbsaRowDto,
  type ExecutiveMetricsResponse,
  type FeatureMetric,
  type IngestResponseRequest,
  type NpsDistribution,
  type QuadrantPointDto,
  type VerbatimQuery,
} from "../contracts";
import { redact, verifyNoLeakage, REDACTION_VERSION } from "../ingestion/redaction";
import { runSafetyGate, SAFETY_CLASSIFIER_VERSION } from "../ingestion/safetyGate";
import { classifyAbsa, ABSA_CLASSIFIER_VERSION } from "../ingestion/absa";
import { route as routeDecision } from "../ingestion/routing";
import { isAllowedTransition } from "../ticketRules";
import { store } from "../store"; // realtime pub/sub only — process-local regardless of storage backend
import type { IngestOutcome, Repository, TicketSnapshot, UpdateTicketResult } from "./types";
import { deltaOf, previousFilters, trustStatus } from "../synthetic/dashboardMetrics";
import { BUCKETS, MISMATCH_CODES, npsOf, type BucketQuota } from "../synthetic/quotas";

function distribution(promoters: number, passives: number, detractors: number): NpsDistribution {
  const total = promoters + passives + detractors || 1;
  return {
    promotersPct: Number(((promoters / total) * 100).toFixed(1)),
    passivesPct: Number(((passives / total) * 100).toFixed(1)),
    detractorsPct: Number(((detractors / total) * 100).toFixed(1)),
    promotersCount: promoters,
    passivesCount: passives,
    detractorsCount: detractors,
  };
}

function npsFrom(promoters: number, passives: number, detractors: number): number {
  return npsOf(promoters, detractors, promoters + passives + detractors);
}

/** Builds the shared WHERE clause + params for filtering fact_nps_response by AnalyticsFilters. */
function buildFilterClause(filters: AnalyticsFilters, startParamIndex: number) {
  const conditions: string[] = [
    `received_at >= $${startParamIndex}::timestamptz`,
    `received_at < $${startParamIndex + 1}::timestamptz`,
  ];
  const params: unknown[] = [filters.from, filters.to];
  let i = startParamIndex + 2;

  if (filters.surveyType) {
    conditions.push(`survey_type = $${i}`);
    params.push(filters.surveyType);
    i += 1;
  }
  if (filters.feature) {
    conditions.push(
      `feature_touchpoint_id = (SELECT feature_touchpoint_id FROM dim_feature_touchpoint WHERE feature_key = $${i})`,
    );
    params.push(filters.feature);
    i += 1;
  }
  if (filters.aspect) {
    conditions.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements(aspects) e WHERE e->>'aspect' = $${i})`,
    );
    params.push(filters.aspect);
    i += 1;
  }
  return { clause: conditions.join(" AND "), params, nextIndex: i };
}

const TREND_MONTH: Record<BucketQuota["id"], string> = {
  mar: "Mar",
  apr: "Apr",
  may: "May",
  jun: "Jun",
  jul_early: "Jul",
  prior: "Aug",
  demo: "Sep",
};

const TREND_CASE = `CASE ${BUCKETS.map(
  (bucket) =>
    `WHEN received_at >= '${bucket.from}'::timestamptz AND received_at < '${bucket.to}'::timestamptz THEN '${TREND_MONTH[bucket.id]}'`,
).join(" ")} END`;

const MISMATCH_ARRAY = `ARRAY[${MISMATCH_CODES.map((code) => `'${code}'`).join(",")}]::text[]`;

function rateOrNull(numerator: number, denominator: number, digits: number): number | null {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(digits));
}

async function measureWindow(pool: Pool, filters: AnalyticsFilters) {
  const { clause, params } = buildFilterClause(filters, 1);
  const scope = [filters.from, filters.to, filters.feature ?? null, filters.cohort ?? null];
  const {
    rows: [agg],
  } = await pool.query(
    `SELECT
       count(*) AS total,
       count(*) FILTER (WHERE nps_tier = 'promoter') AS promoters,
       count(*) FILTER (WHERE nps_tier = 'passive') AS passives,
       count(*) FILTER (WHERE nps_tier = 'detractor') AS detractors,
       count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'promoter') AS rel_p,
       count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'detractor') AS rel_d,
       count(*) FILTER (WHERE survey_type = 'relational') AS rel_total,
       count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'promoter') AS tx_p,
       count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'detractor') AS tx_d,
       count(*) FILTER (WHERE survey_type = 'transactional') AS tx_total,
       count(*) FILTER (WHERE anxiety_pair_valid) AS pairs,
       count(*) FILTER (WHERE anxiety_pair_valid AND anxiety_post < anxiety_pre) AS improved,
       count(*) FILTER (WHERE comprehension_applicable) AS answers,
       count(*) FILTER (WHERE comprehension_applicable AND understood_without_search) AS understood,
       count(*) FILTER (WHERE disclaimer_exposed) AS exposed,
       count(*) FILTER (WHERE disclaimer_exposed AND disclaimer_polarity < 0) AS fatigued
     FROM fact_nps_response WHERE ${clause}`,
    params,
  );
  const {
    rows: [sessions],
  } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE eligible_clinical) AS eligible_sessions,
       count(*) FILTER (WHERE eligible_clinical AND mismatch_codes && ${MISMATCH_ARRAY}) AS mismatch_sessions
     FROM fact_clinical_session s
     WHERE s.started_at >= $1::timestamptz AND s.started_at < $2::timestamptz
       AND ($3::text IS NULL OR s.feature_key = $3)
       AND (
         $4::text IS NULL
         OR s.user_cohort_id = (SELECT user_cohort_id FROM dim_user_cohort WHERE cohort_key = $4)
       )`,
    scope,
  );
  const {
    rows: [invites],
  } = await pool.query(
    `SELECT count(*) FILTER (WHERE i.eligible) AS eligible
     FROM fact_survey_invitation i
     LEFT JOIN fact_clinical_session s ON s.session_id = i.session_id
     WHERE i.delivered_at >= $1::timestamptz AND i.delivered_at < $2::timestamptz
       AND ($3::text IS NULL OR i.feature_key = $3)
       AND (
         $4::text IS NULL
         OR s.user_cohort_id = (SELECT user_cohort_id FROM dim_user_cohort WHERE cohort_key = $4)
       )`,
    scope,
  );
  const {
    rows: [tickets],
  } = await pool.query(
    `WITH scoped AS (
       SELECT t.*
       FROM fact_closed_loop_ticket t
       LEFT JOIN fact_clinical_session s ON s.session_id = t.session_id
       WHERE t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
         AND ($3::text IS NULL OR s.feature_key = $3)
         AND (
           $4::text IS NULL
           OR s.user_cohort_id = (SELECT user_cohort_id FROM dim_user_cohort WHERE cohort_key = $4)
         )
     )
     SELECT
       count(*) AS tickets,
       count(*) FILTER (WHERE status = 'resolved') AS resolved,
       count(*) FILTER (WHERE priority = 'p0' AND status = 'open') AS open_p0
     FROM scoped`,
    scope,
  );
  const {
    rows: [medianAgg],
  } = await pool.query(
    `WITH delays AS (
       SELECT EXTRACT(EPOCH FROM (t.first_contact_at - t.created_at)) AS delay
       FROM fact_closed_loop_ticket t
       LEFT JOIN fact_clinical_session s ON s.session_id = t.session_id
       WHERE t.first_contact_at IS NOT NULL
         AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
         AND ($3::text IS NULL OR s.feature_key = $3)
         AND (
           $4::text IS NULL
           OR s.user_cohort_id = (SELECT user_cohort_id FROM dim_user_cohort WHERE cohort_key = $4)
         )
     ),
     ordered AS (
       SELECT delay, row_number() OVER (ORDER BY delay) AS rn, count(*) OVER () AS n FROM delays
     )
     SELECT delay FROM ordered WHERE rn = floor(n / 2) + 1`,
    scope,
  );
  const { rows: trendRows } = await pool.query(
    `SELECT ${TREND_CASE} AS period,
       count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'promoter') AS rel_p,
       count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'detractor') AS rel_d,
       count(*) FILTER (WHERE survey_type = 'relational') AS rel_total,
       count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'promoter') AS tx_p,
       count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'detractor') AS tx_d,
       count(*) FILTER (WHERE survey_type = 'transactional') AS tx_total,
       min(received_at) AS first_at
     FROM fact_nps_response WHERE ${clause}
     GROUP BY 1
     HAVING ${TREND_CASE} IS NOT NULL
     ORDER BY min(received_at)`,
    params,
  );
  const total = Number(agg.total);
  const promoters = Number(agg.promoters);
  const passives = Number(agg.passives);
  const detractors = Number(agg.detractors);
  const relTotal = Number(agg.rel_total);
  const txTotal = Number(agg.tx_total);
  return {
    total,
    promoters,
    passives,
    detractors,
    relational: npsFrom(
      Number(agg.rel_p),
      relTotal - Number(agg.rel_p) - Number(agg.rel_d),
      Number(agg.rel_d),
    ),
    transactional: npsFrom(
      Number(agg.tx_p),
      txTotal - Number(agg.tx_p) - Number(agg.tx_d),
      Number(agg.tx_d),
    ),
    overall: npsFrom(promoters, passives, detractors),
    distribution: distribution(promoters, passives, detractors),
    eligibleInvitations: Number(invites.eligible),
    pairs: Number(agg.pairs),
    improved: Number(agg.improved),
    answers: Number(agg.answers),
    understood: Number(agg.understood),
    exposed: Number(agg.exposed),
    fatigued: Number(agg.fatigued),
    eligibleSessions: Number(sessions.eligible_sessions),
    mismatchSessions: Number(sessions.mismatch_sessions),
    tickets: Number(tickets.tickets),
    resolved: Number(tickets.resolved),
    openP0: Number(tickets.open_p0),
    medianSeconds:
      medianAgg?.delay === undefined || medianAgg?.delay === null
        ? null
        : Math.round(Number(medianAgg.delay)),
    trend: trendRows.map((row) => ({
      period: String(row.period),
      relational: npsFrom(
        Number(row.rel_p),
        Number(row.rel_total) - Number(row.rel_p) - Number(row.rel_d),
        Number(row.rel_d),
      ),
      transactional: npsFrom(
        Number(row.tx_p),
        Number(row.tx_total) - Number(row.tx_p) - Number(row.tx_d),
        Number(row.tx_d),
      ),
    })),
  };
}

export function createPostgresRepository(pool: Pool): Repository {
  return {
    kind: "postgres",

    async getExecutiveMetrics(filters: AnalyticsFilters): Promise<ExecutiveMetricsResponse> {
      const current = await measureWindow(pool, filters);
      const prior = await measureWindow(pool, previousFilters(filters));
      const priorNps = (value: number, sample: number) => (sample === 0 ? null : value);
      const responseRate = rateOrNull(current.total, current.eligibleInvitations, 1) ?? 0;
      const priorResponseRate = rateOrNull(prior.total, prior.eligibleInvitations, 1);
      const ard = rateOrNull(current.improved, current.pairs, 1) ?? 0;
      const priorArd = rateOrNull(prior.improved, prior.pairs, 1);
      const ccs = rateOrNull(current.understood, current.answers, 1) ?? 0;
      const priorCcs = rateOrNull(prior.understood, prior.answers, 1);
      const hfr = rateOrNull(current.mismatchSessions, current.eligibleSessions, 2) ?? 0;
      const priorHfr = rateOrNull(prior.mismatchSessions, prior.eligibleSessions, 2);
      const dfi = rateOrNull(current.fatigued, current.exposed, 1) ?? 0;
      const priorDfi = rateOrNull(prior.fatigued, prior.exposed, 1);
      const closeRate = current.tickets
        ? Number(((current.resolved / current.tickets) * 100).toFixed(1))
        : 0;
      const priorClose = prior.tickets
        ? Number(((prior.resolved / prior.tickets) * 100).toFixed(1))
        : null;

      return {
        generatedAt: new Date().toISOString(),
        period: { from: filters.from, to: filters.to, timezone: filters.timezone },
        sample: {
          responses: current.total,
          eligibleSurveys: current.eligibleInvitations,
          suppressed: current.total < 20,
        },
        nps: {
          overall: {
            value: current.overall,
            previousValue: priorNps(prior.overall, prior.total),
            delta: deltaOf(current.overall, priorNps(prior.overall, prior.total), 0),
          },
          relational: {
            value: current.relational,
            previousValue: priorNps(prior.relational, prior.total),
            delta: deltaOf(current.relational, priorNps(prior.relational, prior.total), 0),
          },
          transactional: {
            value: current.transactional,
            previousValue: priorNps(prior.transactional, prior.total),
            delta: deltaOf(current.transactional, priorNps(prior.transactional, prior.total), 0),
          },
          responseRate: {
            value: responseRate,
            previousValue: priorResponseRate,
            delta: deltaOf(responseRate, priorResponseRate, 1),
            numerator: current.total,
            denominator: current.eligibleInvitations,
          },
          distribution: current.distribution,
          trend: current.trend,
        },
        medicalTrust: {
          anxietyReductionDelta: {
            value: ard,
            previousValue: priorArd,
            delta: deltaOf(ard, priorArd, 1),
            numerator: current.improved,
            denominator: current.pairs,
            status: trustStatus("ard", ard),
            target: { operator: "gt", value: 75 },
          },
          clinicalComprehensionScore: {
            value: ccs,
            previousValue: priorCcs,
            delta: deltaOf(ccs, priorCcs, 1),
            numerator: current.understood,
            denominator: current.answers,
            status: trustStatus("ccs", ccs),
            target: { operator: "gt", value: 85 },
          },
          hallucinationFlagRate: {
            value: hfr,
            previousValue: priorHfr,
            delta: deltaOf(hfr, priorHfr, 2),
            numerator: current.mismatchSessions,
            denominator: current.eligibleSessions,
            status: trustStatus("hfr", hfr),
            target: { operator: "lt", value: 0.2 },
          },
          disclaimerFatigueIndex: {
            value: dfi,
            previousValue: priorDfi,
            delta: deltaOf(dfi, priorDfi, 1),
            numerator: current.fatigued,
            denominator: current.exposed,
            status: trustStatus("dfi", dfi),
            target: { operator: "lt", value: 5 },
          },
        },
        closedLoop: {
          medianTimeToFirstContactSeconds: current.medianSeconds,
          closeRate: {
            value: closeRate,
            previousValue: priorClose,
            delta: deltaOf(closeRate, priorClose, 1),
          },
          openP0Count: current.openP0,
        },
      };
    },

    async getFeatureMetrics(filters: AnalyticsFilters): Promise<FeatureMetric[]> {
      const { clause, params } = buildFilterClause(filters, 1);

      const { rows } = await pool.query(
        `WITH base AS (
           SELECT * FROM fact_nps_response WHERE ${clause}
         ),
         aspect_agg AS (
           SELECT b.feature_touchpoint_id, e->>'aspect' AS aspect, sum((e->>'polarity')::numeric) AS impact
           FROM base b, jsonb_array_elements(b.aspects) e
           GROUP BY b.feature_touchpoint_id, e->>'aspect'
         ),
         top_driver AS (
           SELECT DISTINCT ON (feature_touchpoint_id) feature_touchpoint_id, aspect, impact
           FROM aspect_agg ORDER BY feature_touchpoint_id, abs(impact) DESC
         )
         SELECT f.feature_key, f.feature_name,
           count(b.response_id) AS response_count,
           count(*) FILTER (WHERE b.nps_tier = 'promoter') AS promoters,
           count(*) FILTER (WHERE b.nps_tier = 'passive') AS passives,
           count(*) FILTER (WHERE b.nps_tier = 'detractor') AS detractors,
           count(*) FILTER (WHERE b.safety_flag) AS safety_flags,
           td.aspect AS top_aspect, td.impact AS top_impact
         FROM dim_feature_touchpoint f
         LEFT JOIN base b ON b.feature_touchpoint_id = f.feature_touchpoint_id
         LEFT JOIN top_driver td ON td.feature_touchpoint_id = f.feature_touchpoint_id
         GROUP BY f.feature_key, f.feature_name, td.aspect, td.impact
         ORDER BY response_count DESC NULLS LAST`,
        params,
      );

      const prior = buildFilterClause(previousFilters(filters), 1);
      const { rows: priorRows } = await pool.query(
        `WITH base AS (
           SELECT * FROM fact_nps_response WHERE ${prior.clause}
         )
         SELECT f.feature_key,
           count(b.response_id) AS response_count,
           count(*) FILTER (WHERE b.nps_tier = 'promoter') AS promoters,
           count(*) FILTER (WHERE b.nps_tier = 'passive') AS passives,
           count(*) FILTER (WHERE b.nps_tier = 'detractor') AS detractors
         FROM dim_feature_touchpoint f
         LEFT JOIN base b ON b.feature_touchpoint_id = f.feature_touchpoint_id
         GROUP BY f.feature_key`,
        prior.params,
      );
      const priorNps = new Map(
        priorRows.map((row) => [
          String(row.feature_key),
          Number(row.response_count) === 0
            ? null
            : npsFrom(Number(row.promoters), Number(row.passives), Number(row.detractors)),
        ]),
      );

      return rows.map((r): FeatureMetric => {
        const promoters = Number(r.promoters);
        const passives = Number(r.passives);
        const detractors = Number(r.detractors);
        const nps = npsFrom(promoters, passives, detractors);
        const previous = priorNps.get(String(r.feature_key)) ?? null;
        return {
          featureKey: r.feature_key,
          featureName: r.feature_name,
          nps,
          monthOverMonthDelta: previous === null ? null : nps - previous,
          responseCount: Number(r.response_count),
          distribution: distribution(promoters, passives, detractors),
          topDriver: r.top_aspect
            ? {
                aspect: r.top_aspect,
                label: r.top_aspect.replace(/_/g, " "),
                impact: Number(Number(r.top_impact).toFixed(2)),
              }
            : null,
          safetyFlagCount: Number(r.safety_flags),
        };
      });
    },

    async getQuadrant(
      filters: AnalyticsFilters,
      minVolume: number,
      criticalOnly?: boolean,
    ): Promise<QuadrantPointDto[]> {
      const { clause, params } = buildFilterClause(filters, 1);

      const { rows } = await pool.query(
        `WITH base AS (SELECT * FROM fact_nps_response WHERE ${clause})
         SELECT f.feature_key, e->>'aspect' AS aspect,
           count(DISTINCT b.response_id) AS volume,
           sum((e->>'polarity')::numeric) AS net_polarity,
           bool_or(COALESCE(o.critical, false)) AS critical_pin,
           max(o.note) AS note
         FROM base b
         JOIN dim_feature_touchpoint f ON f.feature_touchpoint_id = b.feature_touchpoint_id
         CROSS JOIN LATERAL jsonb_array_elements(b.aspects) e
         LEFT JOIN fact_theme_override o
           ON o.feature_key = f.feature_key AND o.aspect = e->>'aspect'
         GROUP BY f.feature_key, e->>'aspect'`,
        params,
      );

      const points: QuadrantPointDto[] = [];
      for (const r of rows) {
        const volume = Number(r.volume);
        const net = Number(r.net_polarity);
        const aspect = r.aspect as string;
        const critical = r.critical_pin === true;
        if (volume < minVolume && !critical) continue;
        if (criticalOnly && !critical) continue;
        points.push({
          id: `${r.feature_key}:${aspect}`,
          theme: r.note ? String(r.note) : aspect.replace(/_/g, " "),
          featureKey: r.feature_key,
          aspect,
          volume,
          netSentimentImpact: Number(net.toFixed(2)),
          critical,
          note: r.note
            ? String(r.note)
            : critical
              ? "Low volume, high impact — route to safety review."
              : "",
        });
      }
      return points;
    },

    async getAbsaRows(filters: AnalyticsFilters): Promise<AbsaRowDto[]> {
      const { clause, params } = buildFilterClause(filters, 1);

      const { rows } = await pool.query(
        `WITH base AS (SELECT * FROM fact_nps_response WHERE ${clause})
         SELECT e->>'aspect' AS aspect,
           count(*) AS mentions,
           count(*) FILTER (WHERE (e->>'polarity')::numeric > 0) AS positive,
           count(*) FILTER (WHERE (e->>'polarity')::numeric < 0) AS negative
         FROM base b, jsonb_array_elements(b.aspects) e
         GROUP BY e->>'aspect'`,
        params,
      );

      return rows.map((r): AbsaRowDto => {
        const mentions = Number(r.mentions);
        const positive = Number(r.positive);
        const negative = Number(r.negative);
        const aspect = r.aspect as string;
        return {
          aspect: aspect.replace(/_/g, " "),
          category: CLINICAL_ASPECTS.has(aspect as AspectKey) ? "clinical" : "operational",
          mentions,
          positivePct: Number(((positive / mentions) * 100).toFixed(1)),
          neutralPct: Number((((mentions - positive - negative) / mentions) * 100).toFixed(1)),
          negativePct: Number(((negative / mentions) * 100).toFixed(1)),
        };
      });
    },

    async queryVerbatims(query: VerbatimQuery) {
      const conditions: string[] = [
        "r.received_at >= $1::timestamptz",
        "r.received_at < $2::timestamptz",
      ];
      const params: unknown[] = [query.from, query.to];
      let i = 3;

      if (query.feature) {
        conditions.push(
          `r.feature_touchpoint_id = (SELECT feature_touchpoint_id FROM dim_feature_touchpoint WHERE feature_key = $${i})`,
        );
        params.push(query.feature);
        i += 1;
      }
      if (query.aspect) {
        conditions.push(
          `EXISTS (SELECT 1 FROM jsonb_array_elements(r.aspects) e WHERE e->>'aspect' = $${i})`,
        );
        params.push(query.aspect);
        i += 1;
      }
      if (query.surveyType) {
        conditions.push(`r.survey_type = $${i}`);
        params.push(query.surveyType);
        i += 1;
      }
      if (query.safetyRisk !== undefined) {
        conditions.push(`r.safety_flag = $${i}`);
        params.push(query.safetyRisk);
        i += 1;
      }
      if (query.polarity) {
        if (query.polarity === "positive") conditions.push(`r.sentiment_score > 0`);
        if (query.polarity === "negative") conditions.push(`r.sentiment_score < 0`);
        if (query.polarity === "neutral")
          conditions.push(`(r.sentiment_score = 0 OR r.sentiment_score IS NULL)`);
      }
      if (query.search) {
        conditions.push(`r.verbatim_redacted ILIKE $${i}`);
        params.push(`%${query.search}%`);
        i += 1;
      }
      if (query.slaStatus) {
        conditions.push(`t.status = $${i}`);
        params.push(query.slaStatus);
        i += 1;
      }
      if (query.cursor) {
        const decoded = Buffer.from(query.cursor, "base64url").toString("utf8").split("|");
        if (decoded.length === 2) {
          conditions.push(`(r.received_at, r.response_id) < ($${i}::timestamptz, $${i + 1}::uuid)`);
          params.push(decoded[0], decoded[1]);
          i += 2;
        }
      }

      params.push(query.limit + 1);
      const limitParam = i;

      const { rows } = await pool.query(
        `SELECT r.response_id, r.received_at, r.nps_score, r.nps_tier, r.sentiment_score, r.survey_type,
                r.verbatim_redacted, r.redaction_tags, r.redaction_count, r.aspects, r.safety_flag,
                r.safety_reason_codes, r.route_action, r.session_ref, r.model_version, r.channel,
                f.feature_key, f.feature_name,
                t.ticket_id, t.status AS ticket_status, t.sla_due_at, t.sla_breached_at
         FROM fact_nps_response r
         LEFT JOIN dim_feature_touchpoint f ON f.feature_touchpoint_id = r.feature_touchpoint_id
         LEFT JOIN fact_closed_loop_ticket t ON t.response_id = r.response_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY r.received_at DESC, r.response_id DESC
         LIMIT $${limitParam}`,
        params,
      );

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);

      return {
        data: page.map((r) => ({
          id: r.response_id,
          receivedAt: new Date(r.received_at).toISOString(),
          score: r.nps_score,
          tier: r.nps_tier,
          sentiment: r.sentiment_score !== null ? Number(r.sentiment_score) : 0,
          feature: { key: r.feature_key ?? "unknown", name: r.feature_name ?? "Unknown" },
          surveyType: r.survey_type,
          text: r.verbatim_redacted ?? "",
          redactions: (r.redaction_tags ?? []).map((tag: string) => ({
            tag,
            count: r.redaction_count,
          })),
          aspects: r.aspects ?? [],
          safety: { flagged: r.safety_flag, reasonCodes: r.safety_reason_codes ?? [] },
          routeAction: r.route_action ?? "micro_poll",
          ticket: r.ticket_id
            ? {
                id: r.ticket_id,
                status: r.ticket_status,
                slaDueAt: new Date(r.sla_due_at).toISOString(),
                breached: Boolean(r.sla_breached_at),
              }
            : null,
          telemetry: {
            sessionRef: r.session_ref,
            modelVersion: r.model_version,
            deviceFamily: null,
            channel: r.channel,
          },
        })),
        page: {
          nextCursor: hasMore
            ? Buffer.from(
                `${page[page.length - 1].received_at.toISOString()}|${page[page.length - 1].response_id}`,
                "utf8",
              ).toString("base64url")
            : null,
          hasMore,
        },
        meta: { requestId: "", generatedAt: new Date().toISOString() },
      };
    },

    async findExistingIngest(sourceSystem, externalResponseId) {
      if (!externalResponseId) return null;
      const { rows } = await pool.query(
        `SELECT response_id, processing_status, route_action, safety_flag, safety_reason_codes
         FROM fact_nps_response WHERE source_system = $1 AND external_response_id = $2`,
        [sourceSystem, externalResponseId],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        responseId: r.response_id,
        processingStatus: r.processing_status,
        routeAction: r.route_action,
        safetyFlag: r.safety_flag,
        safetyReasonCodes: r.safety_reason_codes ?? [],
      };
    },

    async ingestResponse(
      request: IngestResponseRequest,
      requestId: string,
    ): Promise<IngestOutcome> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const featureRes = request.featureKey
          ? await client.query(
              `SELECT feature_touchpoint_id FROM dim_feature_touchpoint WHERE feature_key = $1`,
              [request.featureKey],
            )
          : { rows: [] as Array<{ feature_touchpoint_id: string }> };
        const featureTouchpointId = featureRes.rows[0]?.feature_touchpoint_id ?? null;

        // Note: response_processing_audit.response_id has a NOT NULL foreign key into
        // fact_nps_response, so an "ingress" stage row can't be written until the response row
        // itself exists — the first audit row we can legitimately write is 'routing', after the
        // INSERT below.

        const rawText = request.rawText ?? "";
        const gate = runSafetyGate(rawText);
        const { redactedText, redactions, redactionCount } = redact(rawText);
        const leakageClean = verifyNoLeakage(redactedText);

        const receivedAt = request.receivedAt ?? new Date().toISOString();
        const npsTier =
          request.score <= 6 ? "detractor" : request.score <= 8 ? "passive" : "promoter";

        if (!leakageClean) {
          const {
            rows: [inserted],
          } = await client.query(
            `INSERT INTO fact_nps_response
               (external_response_id, source_system, received_at, survey_type, nps_score, nps_tier,
                feature_touchpoint_id, session_ref, channel, locale, response_eligible,
                redaction_tags, redaction_count, redaction_version, safety_flag, safety_reason_codes,
                safety_confidence, model_version, classifier_version, processing_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'{}',0,$11,$12,$13,$14,$15,$16,'failed')
             RETURNING response_id`,
            [
              request.externalResponseId ?? null,
              request.sourceSystem,
              receivedAt,
              request.surveyType,
              request.score,
              npsTier,
              featureTouchpointId,
              request.sessionRef ?? null,
              request.channel,
              request.locale ?? null,
              REDACTION_VERSION,
              gate.flagged,
              gate.reasonCodes,
              gate.flagged ? gate.confidence : null,
              request.modelVersion ?? null,
              SAFETY_CLASSIFIER_VERSION,
            ],
          );
          await client.query(
            `INSERT INTO response_processing_audit (response_id, stage, status, detail_codes, request_id)
             VALUES ($1, 'leakage_scan', 'failed', '{}', $2)`,
            [inserted.response_id, requestId],
          );
          await client.query("COMMIT");
          return {
            responseId: inserted.response_id,
            processingStatus: "failed",
            routeAction: null,
            safetyFlag: gate.flagged,
            safetyReasonCodes: gate.reasonCodes,
          };
        }

        const absa = classifyAbsa(redactedText);
        const decision = routeDecision({
          score: request.score,
          safetyFlagged: gate.flagged,
          requiresImmediateReview: gate.requiresImmediateReview,
          reviewEligible: request.score >= 9,
        });

        const {
          rows: [inserted],
        } = await client.query(
          `INSERT INTO fact_nps_response
             (external_response_id, source_system, received_at, survey_type, nps_score, nps_tier,
              feature_touchpoint_id, session_ref, channel, locale, response_eligible,
              verbatim_redacted, redaction_tags, redaction_count, redaction_version,
              sentiment_score, aspects, safety_flag, safety_reason_codes, safety_confidence,
              route_action, model_version, classifier_version, processing_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'routed')
           RETURNING response_id`,
          [
            request.externalResponseId ?? null,
            request.sourceSystem,
            receivedAt,
            request.surveyType,
            request.score,
            npsTier,
            featureTouchpointId,
            request.sessionRef ?? null,
            request.channel,
            request.locale ?? null,
            redactedText || null,
            redactions.map((r) => r.tag),
            redactionCount,
            REDACTION_VERSION,
            absa.sentiment,
            JSON.stringify(absa.aspects),
            gate.flagged,
            gate.reasonCodes,
            gate.flagged ? gate.confidence : null,
            decision.action,
            request.modelVersion ?? null,
            ABSA_CLASSIFIER_VERSION,
          ],
        );
        const responseId = inserted.response_id;

        if (decision.action === "p0_clinical_page" || decision.action === "cs_ticket") {
          const slaDueAt = new Date(Date.now() + (decision.slaSeconds ?? 0) * 1000).toISOString();
          await client.query(
            `INSERT INTO fact_closed_loop_ticket
               (response_id, ticket_type, status, priority, owner_team, last_updated_by, sla_due_at)
             VALUES ($1,$2,'open',$3,$4,'00000000-0000-0000-0000-000000000000',$5)`,
            [
              responseId,
              decision.action === "p0_clinical_page" ? "p0_clinical" : "customer_success",
              decision.priority,
              decision.action === "p0_clinical_page" ? "clinical_safety" : "customer_success",
              slaDueAt,
            ],
          );
        }

        await client.query(
          `INSERT INTO response_processing_audit (response_id, stage, status, detail_codes, request_id)
           VALUES ($1, 'routing', 'completed', $2, $3)`,
          [responseId, [decision.action], requestId],
        );

        await client.query("COMMIT");

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

        return {
          responseId,
          processingStatus: "routed",
          routeAction: decision.action,
          safetyFlag: gate.flagged,
          safetyReasonCodes: gate.reasonCodes,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getTicket(ticketId: string): Promise<TicketSnapshot | null> {
      const { rows } = await pool.query(
        `SELECT * FROM fact_closed_loop_ticket WHERE ticket_id = $1`,
        [ticketId],
      );
      if (rows.length === 0) return null;
      return mapTicketRow(rows[0]);
    },

    async updateTicket(ticketId, patch): Promise<UpdateTicketResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT * FROM fact_closed_loop_ticket WHERE ticket_id = $1 FOR UPDATE`,
          [ticketId],
        );
        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "not_found" };
        }
        const current = mapTicketRow(rows[0]);
        if (current.version !== patch.version) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "version_conflict" };
        }

        const reopeningResolved = current.status === "resolved" && patch.status !== "resolved";
        const allowed = isAllowedTransition(current.status, patch.status);
        if (!allowed && !(reopeningResolved && patch.allowReopenResolved)) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            reason: "invalid_transition",
            from: current.status,
            to: patch.status,
          };
        }
        if (reopeningResolved && !patch.reason) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "reason_required" };
        }
        if (
          current.ticketType === "p0_clinical" &&
          patch.status === "resolved" &&
          !patch.resolutionCode
        ) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "resolution_code_required" };
        }

        const now = new Date().toISOString();
        const {
          rows: [updated],
        } = await client.query(
          `UPDATE fact_closed_loop_ticket SET
             status = $1::ticket_status,
             version = version + 1,
             updated_at = $2::timestamptz,
             first_contact_at = COALESCE(first_contact_at, CASE WHEN $1::ticket_status = 'contacted' THEN $2::timestamptz ELSE NULL END),
             resolved_at = CASE WHEN $1::ticket_status = 'resolved' THEN $2::timestamptz ELSE resolved_at END,
             resolution_code = COALESCE($3, resolution_code),
             last_updated_by = $4
           WHERE ticket_id = $5
           RETURNING *`,
          [patch.status, now, patch.resolutionCode ?? null, patch.actorId, ticketId],
        );

        await client.query(
          `INSERT INTO ticket_status_event (ticket_id, old_status, new_status, actor_id, request_id, reason)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ticketId, current.status, patch.status, patch.actorId, "n/a", patch.reason ?? null],
        );

        await client.query("COMMIT");

        const snapshot = mapTicketRow(updated);
        store.publish({
          type: "ticket.updated",
          id: ticketId,
          occurredAt: snapshot.updatedAt,
          status: snapshot.status,
          version: snapshot.version,
        });
        return { ok: true, ticket: snapshot };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    subscribeRealtime(fn) {
      return store.subscribe(fn);
    },
  };
}

interface TicketRowSql {
  ticket_id: string;
  response_id: string | null;
  ticket_type: TicketSnapshot["ticketType"];
  status: TicketSnapshot["status"];
  priority: TicketSnapshot["priority"];
  owner_team: string;
  created_at: string | Date;
  first_contact_at: string | Date | null;
  resolved_at: string | Date | null;
  sla_due_at: string | Date;
  sla_breached_at: string | Date | null;
  resolution_code: string | null;
  last_updated_by: string;
  version: number;
  updated_at: string | Date;
}

function mapTicketRow(r: TicketRowSql): TicketSnapshot {
  return {
    ticketId: r.ticket_id,
    responseId: r.response_id,
    ticketType: r.ticket_type,
    status: r.status,
    priority: r.priority,
    ownerTeam: r.owner_team,
    createdAt: new Date(r.created_at).toISOString(),
    firstContactAt: r.first_contact_at ? new Date(r.first_contact_at).toISOString() : null,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    slaDueAt: new Date(r.sla_due_at).toISOString(),
    slaBreachedAt: r.sla_breached_at ? new Date(r.sla_breached_at).toISOString() : null,
    resolutionCode: r.resolution_code,
    lastUpdatedBy: r.last_updated_by,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
