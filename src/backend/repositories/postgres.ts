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

const QUADRANT_HIGH_VOLUME = 300;
const QUADRANT_HIGH_IMPACT = 4;

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
  const total = promoters + passives + detractors;
  if (total === 0) return 0;
  return Math.round((promoters / total) * 100 - (detractors / total) * 100);
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

export function createPostgresRepository(pool: Pool): Repository {
  return {
    kind: "postgres",

    async getExecutiveMetrics(filters: AnalyticsFilters): Promise<ExecutiveMetricsResponse> {
      const { clause, params } = buildFilterClause(filters, 1);

      const {
        rows: [agg],
      } = await pool.query(
        `SELECT
           count(*) AS total,
           count(*) FILTER (WHERE response_eligible) AS eligible,
           count(*) FILTER (WHERE nps_tier = 'promoter') AS promoters,
           count(*) FILTER (WHERE nps_tier = 'passive') AS passives,
           count(*) FILTER (WHERE nps_tier = 'detractor') AS detractors,
           count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'promoter') AS rel_p,
           count(*) FILTER (WHERE survey_type = 'relational' AND nps_tier = 'detractor') AS rel_d,
           count(*) FILTER (WHERE survey_type = 'relational') AS rel_total,
           count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'promoter') AS tx_p,
           count(*) FILTER (WHERE survey_type = 'transactional' AND nps_tier = 'detractor') AS tx_d,
           count(*) FILTER (WHERE survey_type = 'transactional') AS tx_total,
           count(*) FILTER (WHERE safety_reason_codes @> ARRAY['contradicts_clinician']) AS hallucination_flagged
         FROM fact_nps_response WHERE ${clause}`,
        params,
      );

      const total = Number(agg.total);
      const promoters = Number(agg.promoters);
      const passives = Number(agg.passives);
      const detractors = Number(agg.detractors);
      const relTotal = Number(agg.rel_total);
      const txTotal = Number(agg.tx_total);

      const {
        rows: [p0],
      } = await pool.query(
        `SELECT count(*) AS open_p0 FROM fact_closed_loop_ticket WHERE status != 'resolved' AND priority = 'p0'`,
      );
      const {
        rows: [closeAgg],
      } = await pool.query(
        `SELECT count(*) AS closed_period, count(*) FILTER (WHERE status = 'resolved') AS resolved_period
         FROM fact_closed_loop_ticket WHERE created_at >= $1::timestamptz`,
        [filters.from],
      );
      const {
        rows: [medianAgg],
      } = await pool.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_contact_at - created_at))) AS median_seconds
         FROM fact_closed_loop_ticket WHERE first_contact_at IS NOT NULL`,
      );

      const closedPeriod = Number(closeAgg.closed_period);
      const resolvedPeriod = Number(closeAgg.resolved_period);

      return {
        generatedAt: new Date().toISOString(),
        period: { from: filters.from, to: filters.to, timezone: filters.timezone },
        sample: { responses: total, eligibleSurveys: Number(agg.eligible), suppressed: total < 20 },
        nps: {
          overall: {
            value: npsFrom(promoters, passives, detractors),
            previousValue: null,
            delta: null,
          },
          relational: {
            value: npsFrom(
              Number(agg.rel_p),
              relTotal - Number(agg.rel_p) - Number(agg.rel_d),
              Number(agg.rel_d),
            ),
            previousValue: null,
            delta: null,
          },
          transactional: {
            value: npsFrom(
              Number(agg.tx_p),
              txTotal - Number(agg.tx_p) - Number(agg.tx_d),
              Number(agg.tx_d),
            ),
            previousValue: null,
            delta: null,
          },
          responseRate: {
            value: Number(agg.eligible)
              ? Number(((total / Number(agg.eligible)) * 100).toFixed(1))
              : 0,
            previousValue: null,
            delta: null,
            numerator: total,
            denominator: Number(agg.eligible),
          },
          distribution: distribution(promoters, passives, detractors),
          trend: [],
        },
        medicalTrust: {
          anxietyReductionDelta: {
            value: 0,
            previousValue: null,
            delta: null,
            target: { operator: "gt", value: 75 },
          },
          clinicalComprehensionScore: {
            value: 0,
            previousValue: null,
            delta: null,
            target: { operator: "gt", value: 85 },
          },
          hallucinationFlagRate: {
            value: total
              ? Number(((Number(agg.hallucination_flagged) / total) * 100).toFixed(2))
              : 0,
            previousValue: null,
            delta: null,
            target: { operator: "lt", value: 0.2 },
          },
          disclaimerFatigueIndex: {
            value: 0,
            previousValue: null,
            delta: null,
            target: { operator: "lt", value: 5 },
          },
        },
        closedLoop: {
          medianTimeToFirstContactSeconds:
            medianAgg.median_seconds !== null ? Math.round(Number(medianAgg.median_seconds)) : null,
          closeRate: {
            value: closedPeriod ? Number(((resolvedPeriod / closedPeriod) * 100).toFixed(1)) : 0,
            previousValue: null,
            delta: null,
          },
          openP0Count: Number(p0.open_p0),
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
           SELECT b.feature_touchpoint_id, e->>'aspect' AS aspect, sum(abs((e->>'polarity')::numeric)) AS impact
           FROM base b, jsonb_array_elements(b.aspects) e
           GROUP BY b.feature_touchpoint_id, e->>'aspect'
         ),
         top_driver AS (
           SELECT DISTINCT ON (feature_touchpoint_id) feature_touchpoint_id, aspect, impact
           FROM aspect_agg ORDER BY feature_touchpoint_id, impact DESC
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

      return rows.map((r): FeatureMetric => {
        const promoters = Number(r.promoters);
        const passives = Number(r.passives);
        const detractors = Number(r.detractors);
        return {
          featureKey: r.feature_key,
          featureName: r.feature_name,
          nps: npsFrom(promoters, passives, detractors),
          monthOverMonthDelta: null,
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
           sum(GREATEST(0, -(e->>'polarity')::numeric)) AS neg_impact
         FROM base b
         JOIN dim_feature_touchpoint f ON f.feature_touchpoint_id = b.feature_touchpoint_id,
           jsonb_array_elements(b.aspects) e
         GROUP BY f.feature_key, e->>'aspect'`,
        params,
      );

      const points: QuadrantPointDto[] = [];
      for (const r of rows) {
        const volume = Number(r.volume);
        const negImpact = Number(r.neg_impact);
        const aspect = r.aspect as string;
        const critical =
          volume < QUADRANT_HIGH_VOLUME &&
          negImpact >= QUADRANT_HIGH_IMPACT &&
          CLINICAL_ASPECTS.has(aspect as AspectKey);
        if (volume < minVolume && !critical) continue;
        if (criticalOnly && !critical) continue;
        points.push({
          id: `${r.feature_key}:${aspect}`,
          theme: aspect.replace(/_/g, " "),
          featureKey: r.feature_key,
          aspect,
          volume,
          netSentimentImpact: Number(negImpact.toFixed(2)),
          critical,
          note: critical ? "Low volume, high impact — route to safety review." : "",
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
  response_id: string;
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
