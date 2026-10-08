#!/usr/bin/env bun
/**
 * Loads data/synthetic/generated/*.jsonl into Postgres.
 * Apply db/migrations/0001_init.sql and 0002_synthetic_metrics.sql first, then:
 *
 *   bun scripts/generate-synthetic-data.mjs
 *   DATABASE_URL=postgres://... bun scripts/seed-postgres.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data", "synthetic", "generated");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!existsSync(path.join(dataDir, "nps_responses.jsonl"))) {
  console.error("Missing generated corpus. Run: bun scripts/generate-synthetic-data.mjs");
  process.exit(1);
}

function readJsonl(file) {
  const text = readFileSync(path.join(dataDir, file), "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

function chunk(rows, size) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

async function insertRows(client, table, columns, rows, casts = {}) {
  if (rows.length === 0) return;
  for (const batch of chunk(rows, 200)) {
    const params = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        params.push(row[column]);
        const cast = casts[column];
        const ref = `$${rowIndex * columns.length + columnIndex + 1}`;
        return cast ? `${ref}::${cast}` : ref;
      });
      return `(${placeholders.join(",")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const { rows: featureRows } = await client.query(
      "SELECT feature_touchpoint_id, feature_key FROM dim_feature_touchpoint",
    );
    const featureIdByKey = new Map(featureRows.map((row) => [row.feature_key, row.feature_touchpoint_id]));
    if (featureIdByKey.size === 0) {
      throw new Error("dim_feature_touchpoint is empty — apply db/migrations/0001_init.sql first.");
    }

    await client.query("BEGIN");

    const cohorts = readJsonl("cohorts.jsonl");
    console.log(`Seeding ${cohorts.length} cohorts...`);
    await insertRows(
      client,
      "dim_user_cohort",
      ["user_cohort_id", "cohort_key", "cohort_name", "plan_type", "tenure_band", "is_active"],
      cohorts,
    );

    const sessions = readJsonl("clinical_sessions.jsonl");
    console.log(`Seeding ${sessions.length} clinical sessions...`);
    await insertRows(
      client,
      "fact_clinical_session",
      [
        "session_id",
        "started_at",
        "feature_key",
        "user_cohort_id",
        "eligible_clinical",
        "mismatch_codes",
        "harm_codes",
      ],
      sessions,
      { mismatch_codes: "text[]", harm_codes: "text[]" },
    );

    const invitations = readJsonl("survey_invitations.jsonl");
    console.log(`Seeding ${invitations.length} survey invitations...`);
    await insertRows(
      client,
      "fact_survey_invitation",
      ["invitation_id", "session_id", "delivered_at", "eligible", "feature_key"],
      invitations,
    );

    const responses = readJsonl("nps_responses.jsonl").map((row) => ({
      ...row,
      feature_touchpoint_id: featureIdByKey.get(row.feature_key) ?? null,
      aspects: JSON.stringify(row.aspects),
    }));
    console.log(`Seeding ${responses.length} NPS responses...`);
    await insertRows(
      client,
      "fact_nps_response",
      [
        "response_id",
        "external_response_id",
        "source_system",
        "received_at",
        "survey_type",
        "nps_score",
        "nps_tier",
        "feature_touchpoint_id",
        "user_cohort_id",
        "session_ref",
        "channel",
        "locale",
        "response_eligible",
        "verbatim_redacted",
        "redaction_tags",
        "redaction_count",
        "redaction_version",
        "sentiment_score",
        "aspects",
        "safety_flag",
        "safety_reason_codes",
        "safety_confidence",
        "route_action",
        "model_version",
        "classifier_version",
        "processing_status",
        "created_at",
        "invitation_id",
        "session_id",
        "anxiety_pre",
        "anxiety_post",
        "anxiety_pair_valid",
        "comprehension_applicable",
        "understood_without_search",
        "disclaimer_exposed",
        "disclaimer_polarity",
      ],
      responses,
      { redaction_tags: "text[]", aspects: "jsonb", safety_reason_codes: "text[]" },
    );

    const tickets = readJsonl("closed_loop_tickets.jsonl");
    console.log(`Seeding ${tickets.length} tickets...`);
    await insertRows(
      client,
      "fact_closed_loop_ticket",
      [
        "ticket_id",
        "response_id",
        "session_id",
        "ticket_type",
        "status",
        "priority",
        "owner_team",
        "owner_id",
        "created_at",
        "first_contact_at",
        "resolved_at",
        "sla_due_at",
        "sla_breached_at",
        "resolution_code",
        "last_updated_by",
        "version",
        "updated_at",
      ],
      tickets,
    );

    const pages = readJsonl("page_events.jsonl");
    console.log(`Seeding ${pages.length} page events...`);
    await insertRows(
      client,
      "fact_page_event",
      ["page_event_id", "ticket_id", "delivered", "sent_at", "acknowledged_at", "detail_code"],
      pages,
    );

    const audits = readJsonl("processing_audit.jsonl");
    console.log(`Seeding ${audits.length} audit events...`);
    await insertRows(
      client,
      "response_processing_audit",
      ["audit_id", "response_id", "stage", "status", "detail_codes", "occurred_at", "request_id"],
      audits,
      { detail_codes: "text[]" },
    );

    const quarantines = readJsonl("redaction_quarantine.jsonl");
    console.log(`Seeding ${quarantines.length} quarantines...`);
    await insertRows(
      client,
      "fact_redaction_quarantine",
      ["quarantine_id", "occurred_at", "stage", "status", "detail_codes"],
      quarantines,
      { detail_codes: "text[]" },
    );

    const overrides = readJsonl("theme_overrides.jsonl");
    console.log(`Seeding ${overrides.length} theme overrides...`);
    await insertRows(
      client,
      "fact_theme_override",
      ["override_id", "feature_key", "aspect", "critical", "note"],
      overrides,
    );

    const telemetry = readJsonl("product_telemetry.jsonl");
    console.log(`Seeding ${telemetry.length} telemetry sessions...`);
    await insertRows(
      client,
      "fact_product_telemetry",
      ["session_id", "device", "cohort_key", "rage_clicks", "dead_clicks", "events", "linked_response_id"],
      telemetry,
      { events: "text[]" },
    );

    await client.query("COMMIT");
    console.log("Done.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
