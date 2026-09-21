#!/usr/bin/env node
/**
 * Loads data/synthetic/*.json into a real Postgres database (schema from
 * db/migrations/0001_init.sql). Requires DATABASE_URL. Run scripts/setup-postgres.sh first.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/seed-postgres.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "synthetic");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run scripts/setup-postgres.sh first, then export DATABASE_URL.");
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8"));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const { rows: featureRows } = await pool.query("SELECT feature_touchpoint_id, feature_key FROM dim_feature_touchpoint");
  const featureIdByKey = new Map(featureRows.map((r) => [r.feature_key, r.feature_touchpoint_id]));
  if (featureIdByKey.size === 0) {
    console.error("dim_feature_touchpoint is empty — run the migration (db/migrations/0001_init.sql) first.");
    process.exit(1);
  }

  const cohorts = readJson("dim_user_cohort.json");
  console.log(`Seeding ${cohorts.length} user cohorts...`);
  for (const c of cohorts) {
    await pool.query(
      `INSERT INTO dim_user_cohort (user_cohort_id, cohort_key, cohort_name, plan_type, tenure_band, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (cohort_key) DO NOTHING`,
      [c.userCohortId, c.cohortKey, c.cohortName, c.planType ?? null, c.tenureBand ?? null, c.isActive ?? true],
    );
  }

  const responses = readJson("fact_nps_response.json");
  console.log(`Seeding ${responses.length} NPS responses...`);
  let inserted = 0;
  for (const batch of chunk(responses, 500)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of batch) {
        const featureId = featureIdByKey.get(r.feature_key) ?? null;
        await client.query(
          `INSERT INTO fact_nps_response
             (response_id, external_response_id, source_system, received_at, survey_type, nps_score, nps_tier,
              feature_touchpoint_id, user_cohort_id, session_ref, channel, locale, response_eligible,
              verbatim_redacted, redaction_tags, redaction_count, redaction_version, sentiment_score, aspects,
              safety_flag, safety_reason_codes, safety_confidence, route_action, model_version,
              classifier_version, processing_status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
           ON CONFLICT (response_id) DO NOTHING`,
          [
            r.response_id, r.external_response_id, r.source_system, r.received_at, r.survey_type, r.nps_score, r.nps_tier,
            featureId, r.user_cohort_id, r.session_ref, r.channel, r.locale, r.response_eligible,
            r.verbatim_redacted, r.redaction_tags, r.redaction_count, r.redaction_version, r.sentiment_score,
            JSON.stringify(r.aspects), r.safety_flag, r.safety_reason_codes, r.safety_confidence, r.route_action,
            r.model_version, r.classifier_version, r.processing_status, r.created_at,
          ],
        );
      }
      await client.query("COMMIT");
      inserted += batch.length;
      process.stdout.write(`\r  ${inserted}/${responses.length}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log();

  const tickets = readJson("fact_closed_loop_ticket.json");
  console.log(`Seeding ${tickets.length} tickets...`);
  for (const t of tickets) {
    await pool.query(
      `INSERT INTO fact_closed_loop_ticket
         (ticket_id, response_id, ticket_type, status, priority, owner_team, owner_id, created_at,
          first_contact_at, resolved_at, sla_due_at, sla_breached_at, resolution_code, last_updated_by, version, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [
        t.ticket_id, t.response_id, t.ticket_type, t.status, t.priority, t.owner_team, t.owner_id, t.created_at,
        t.first_contact_at, t.resolved_at, t.sla_due_at, t.sla_breached_at, t.resolution_code, t.last_updated_by,
        t.version, t.updated_at,
      ],
    );
  }

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
