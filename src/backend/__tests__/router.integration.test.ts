import type { WorkforceRole } from "../auth";
import { beforeAll, describe, expect, it } from "vitest";
import { handleApiRequest } from "../router";
import { mintDevToken, signIngestionRequest } from "../auth";
import type { VerbatimListItem } from "../contracts";

beforeAll(() => {
  process.env["AUTH_JWT_SECRET"] = "test-jwt-secret";
  process.env["INGEST_HMAC_SECRET"] = "test-hmac-secret";
  delete process.env["DATABASE_URL"]; // force the in-memory repository for this test file
});

function authHeaders(role = "administrator") {
  const token = mintDevToken({ sub: "u1", tenantId: "t1", role: role as WorkforceRole });
  return { authorization: `Bearer ${token}` };
}

function ingestHeaders(body: string) {
  const timestamp = Date.now();
  const nonce = `it-${timestamp}-${Math.random().toString(36).slice(2)}`;
  const signature = signIngestionRequest(body, timestamp, nonce);
  return {
    "content-type": "application/json",
    "x-ingest-signature": signature,
    "x-ingest-source-system": "integration-test",
    "x-ingest-timestamp": String(timestamp),
    "x-ingest-nonce": nonce,
  };
}

describe("handleApiRequest", () => {
  it("returns null for non-API paths", async () => {
    const response = await handleApiRequest(new Request("http://localhost/"));
    expect(response).toBeNull();
  });

  it("returns 401 for executive metrics without auth", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/metrics/executive?from=2026-01-01&to=2026-12-31"),
    );
    expect(response?.status).toBe(401);
  });

  it("returns executive metrics with a valid token", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/metrics/executive?from=2026-01-01&to=2026-12-31", {
        headers: authHeaders(),
      }),
    );
    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body.nps).toBeDefined();
    expect(body.sample.responses).toBeGreaterThan(0); // synthetic fixtures auto-loaded
  });

  it("routes a safety-flagged ingest to a P0 ticket, and it appears in verbatims", async () => {
    const externalId = `it-p0-${Date.now()}`;
    const body = JSON.stringify({
      sourceSystem: "integration-test",
      externalResponseId: externalId,
      surveyType: "transactional",
      score: 2,
      featureKey: "symptom_chat_companion",
      channel: "in_app",
      rawText: "I mentioned feeling like I might self-harm and it just moved on.",
    });

    const ingestResponse = await handleApiRequest(
      new Request("http://localhost/api/v1/responses/ingest", {
        method: "POST",
        headers: ingestHeaders(body),
        body,
      }),
    );
    expect(ingestResponse?.status).toBe(202);
    const ingestBody = await ingestResponse!.json();
    expect(ingestBody.processingStatus).toBe("routed");

    const verbatimResponse = await handleApiRequest(
      new Request(
        `http://localhost/api/v1/verbatims?from=2000-01-01&to=2100-01-01&limit=5&search=self-harm`,
        {
          headers: authHeaders("clinical_safety"),
        },
      ),
    );
    expect(verbatimResponse?.status).toBe(200);
    const page = await verbatimResponse!.json();
    const match = page.data.find((v: VerbatimListItem) => v.id === ingestBody.responseId);
    expect(match).toBeDefined();
    expect(match.routeAction).toBe("p0_clinical_page");
    expect(match.safety.flagged).toBe(true);
    expect(match.ticket).not.toBeNull();
    expect(match.ticket.status).toBe("open");
  });

  it("rejects a replayed ingest signature", async () => {
    const body = JSON.stringify({
      sourceSystem: "integration-test",
      externalResponseId: `it-replay-${Date.now()}`,
      surveyType: "transactional",
      score: 8,
      channel: "in_app",
    });
    const headers = ingestHeaders(body);
    const first = await handleApiRequest(
      new Request("http://localhost/api/v1/responses/ingest", { method: "POST", headers, body }),
    );
    expect(first?.status).toBe(202);
    const second = await handleApiRequest(
      new Request("http://localhost/api/v1/responses/ingest", { method: "POST", headers, body }),
    );
    expect(second?.status).toBe(401);
  });

  it("transitions a ticket and rejects a stale-version retry with 409", async () => {
    const externalId = `it-ticket-${Date.now()}`;
    const body = JSON.stringify({
      sourceSystem: "integration-test",
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
    const { responseId } = await ingestResponse!.json();

    const verbatimResponse = await handleApiRequest(
      new Request(
        `http://localhost/api/v1/verbatims?from=2000-01-01&to=2100-01-01&limit=5&search=${encodeURIComponent("consult a doctor")}`,
        {
          headers: authHeaders(),
        },
      ),
    );
    const page = await verbatimResponse!.json();
    const match = page.data.find((v: VerbatimListItem) => v.id === responseId);
    const ticketId = match.ticket.id;

    const patchBody = JSON.stringify({ status: "contacted", version: 0 });
    const patch1 = await handleApiRequest(
      new Request(`http://localhost/api/v1/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { ...authHeaders("customer_success"), "content-type": "application/json" },
        body: patchBody,
      }),
    );
    expect(patch1?.status).toBe(200);
    const updated = await patch1!.json();
    expect(updated.status).toBe("contacted");
    expect(updated.version).toBe(1);

    const patch2 = await handleApiRequest(
      new Request(`http://localhost/api/v1/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { ...authHeaders("customer_success"), "content-type": "application/json" },
        body: patchBody, // still says version 0 — stale
      }),
    );
    expect(patch2?.status).toBe(409);
  });

  it("runs the sandbox simulator without persisting anything", async () => {
    const body = JSON.stringify({
      text: "It failed to parse page 2 of my MRI report, but the doctor said the summary was fine.",
      score: 7,
      featureKey: "mri_imaging_insights",
      surveyType: "transactional",
    });
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/workflow/simulate", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body,
      }),
    );
    expect(response?.status).toBe(200);
    const result = await response!.json();
    expect(result.routing.action).toBe("micro_poll");
    expect(
      result.analysis.aspects.some(
        (a: { aspect: string; polarity: number }) =>
          a.aspect === "document_parsing_ocr" && a.polarity === -1,
      ),
    ).toBe(true);
  });
});
