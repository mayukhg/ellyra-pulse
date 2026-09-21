import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleApiRequest } from "../router";
import type { VerbatimListItem } from "../contracts";
import { signIngestionRequest, mintDevToken } from "../auth";

beforeAll(() => {
  process.env["AUTH_JWT_SECRET"] ??= "test-jwt-secret";
  process.env["INGEST_HMAC_SECRET"] ??= "test-hmac-secret";
  delete process.env["DATABASE_URL"];
});

afterEach(() => {
  delete process.env["INGESTION_MODE"];
});

function ingestHeaders(body: string) {
  const timestamp = Date.now();
  const nonce = `shadow-${timestamp}-${Math.random().toString(36).slice(2)}`;
  const signature = signIngestionRequest(body, timestamp, nonce);
  return {
    "content-type": "application/json",
    "x-ingest-signature": signature,
    "x-ingest-source-system": "shadow-test",
    "x-ingest-timestamp": String(timestamp),
    "x-ingest-nonce": nonce,
  };
}

describe("shadow-mode ingestion (INGESTION_MODE=shadow)", () => {
  it("reports what it would route, but does not persist a response or ticket", async () => {
    process.env["INGESTION_MODE"] = "shadow";

    const externalId = `shadow-${Date.now()}`;
    const body = JSON.stringify({
      sourceSystem: "shadow-test",
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
    const result = await ingestResponse!.json();
    expect(result.shadow).toBe(true);
    expect(result.wouldRoute).toBe("p0_clinical_page");

    // Confirm nothing was actually persisted: searching for this exact external id's text
    // should find no matching verbatim, because shadow mode never calls repository.ingestResponse.
    const token = mintDevToken({ sub: "shadow-reviewer", tenantId: "t1", role: "clinical_safety" });
    const verbatimResponse = await handleApiRequest(
      new Request(
        `http://localhost/api/v1/verbatims?from=2000-01-01&to=2100-01-01&limit=50&search=${encodeURIComponent("self-harm")}`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    const page = await verbatimResponse!.json();
    const match = page.data.find((v: VerbatimListItem) => v.id === result.responseId);
    expect(match).toBeUndefined();
  });

  it("persists normally when INGESTION_MODE is unset (live is the default)", async () => {
    delete process.env["INGESTION_MODE"];

    const externalId = `live-${Date.now()}`;
    const body = JSON.stringify({
      sourceSystem: "shadow-test",
      externalResponseId: externalId,
      surveyType: "transactional",
      score: 9,
      featureKey: "gp_question_builder",
      channel: "in_app",
      rawText: "Gave me a short list of questions to bring to my consultant.",
    });

    const ingestResponse = await handleApiRequest(
      new Request("http://localhost/api/v1/responses/ingest", {
        method: "POST",
        headers: ingestHeaders(body),
        body,
      }),
    );
    const result = await ingestResponse!.json();
    expect(result.shadow).toBeUndefined();
    expect(result.processingStatus).toBe("routed");
  });
});
