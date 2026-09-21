/**
 * Runs the same critical-path checks as router.integration.test.ts, but against the real
 * Postgres repository — skipped entirely unless DATABASE_URL is set, so `bun run test` still
 * passes with no database available. Run explicitly with:
 *   DATABASE_URL=postgres://... bun run test -- router.integration.postgres
 *
 * Unlike the in-memory test, this does NOT delete DATABASE_URL — that's the whole point.
 */
import type { WorkforceRole } from "../auth";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { handleApiRequest } from "../router";
import { mintDevToken, signIngestionRequest } from "../auth";
import { getRepository } from "../repositories";
import type { VerbatimListItem } from "../contracts";

// fact_closed_loop_ticket.last_updated_by (and owner_id) are `uuid` columns per
// db/migrations/0001_init.sql — a real workforce identity provider's user IDs need to be UUIDs
// for this schema, not arbitrary strings like a username or email.
const TEST_USER_ID = randomUUID();

const hasPostgres = Boolean(process.env["DATABASE_URL"]);

beforeAll(() => {
  process.env["AUTH_JWT_SECRET"] ??= "test-jwt-secret";
  process.env["INGEST_HMAC_SECRET"] ??= "test-hmac-secret";
});

function authHeaders(role = "administrator") {
  const token = mintDevToken({ sub: TEST_USER_ID, tenantId: "pg-t1", role: role as WorkforceRole });
  return { authorization: `Bearer ${token}` };
}

function ingestHeaders(body: string) {
  const timestamp = Date.now();
  const nonce = `pgit-${timestamp}-${Math.random().toString(36).slice(2)}`;
  const signature = signIngestionRequest(body, timestamp, nonce);
  return {
    "content-type": "application/json",
    "x-ingest-signature": signature,
    "x-ingest-source-system": "pg-integration-test",
    "x-ingest-timestamp": String(timestamp),
    "x-ingest-nonce": nonce,
  };
}

describe.skipIf(!hasPostgres)("handleApiRequest against real Postgres", () => {
  it("actually selected the postgres repository (sanity check the skip guard is real)", () => {
    expect(getRepository().kind).toBe("postgres");
  });

  it("returns executive metrics computed by real SQL", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/metrics/executive?from=2000-01-01&to=2100-01-01", {
        headers: authHeaders(),
      }),
    );
    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body.sample.responses).toBeGreaterThan(0);
    expect(typeof body.nps.overall.value).toBe("number");
  });

  it("ingests into Postgres, opens a real ticket row, and the PATCH transition persists", async () => {
    const externalId = `pg-it-${Date.now()}`;
    const body = JSON.stringify({
      sourceSystem: "pg-integration-test",
      externalResponseId: externalId,
      surveyType: "transactional",
      score: 3,
      featureKey: "lab_blood_parser",
      channel: "in_app",
      rawText: "Just told me to consult a doctor without explaining anything useful.",
    });

    const ingestResponse = await handleApiRequest(
      new Request("http://localhost/api/v1/responses/ingest", {
        method: "POST",
        headers: ingestHeaders(body),
        body,
      }),
    );
    expect(ingestResponse?.status).toBe(202);
    const { responseId } = await ingestResponse!.json();

    const verbatimResponse = await handleApiRequest(
      new Request(
        `http://localhost/api/v1/verbatims?from=2000-01-01&to=2100-01-01&limit=5&search=${encodeURIComponent("consult a doctor")}`,
        {
          headers: authHeaders("clinical_safety"),
        },
      ),
    );
    const page = await verbatimResponse!.json();
    const match = page.data.find((v: VerbatimListItem) => v.id === responseId);
    expect(match).toBeDefined();
    expect(match.ticket).not.toBeNull();

    const patch = await handleApiRequest(
      new Request(`http://localhost/api/v1/tickets/${match.ticket.id}`, {
        method: "PATCH",
        headers: { ...authHeaders("customer_success"), "content-type": "application/json" },
        body: JSON.stringify({ status: "contacted", version: 0 }),
      }),
    );
    expect(patch?.status).toBe(200);

    // Re-read via getTicket to confirm the write actually landed in Postgres, not just returned
    // in the PATCH response.
    const persisted = await getRepository().getTicket(match.ticket.id);
    expect(persisted?.status).toBe("contacted");
    expect(persisted?.version).toBe(1);
  });
});

if (!hasPostgres) {
  // Vitest requires at least one assertion path to be reachable; this keeps the file from being
  // reported as an empty suite when skipped.
  describe("router.integration.postgres (skipped)", () => {
    it("is skipped because DATABASE_URL is not set", () => {
      expect(hasPostgres).toBe(false);
    });
  });
}
