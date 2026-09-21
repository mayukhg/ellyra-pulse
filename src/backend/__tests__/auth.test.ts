import { beforeAll, describe, expect, it } from "vitest";
import {
  mintDevToken,
  requireWorkforceSession,
  signIngestionRequest,
  verifyIngestionSignature,
  UnauthenticatedError,
} from "../auth";

beforeAll(() => {
  process.env["AUTH_JWT_SECRET"] = "test-jwt-secret";
  process.env["INGEST_HMAC_SECRET"] = "test-hmac-secret";
});

function makeRequest(headers: Record<string, string>) {
  return new Request("http://localhost/api/v1/x", { headers });
}

describe("requireWorkforceSession", () => {
  it("accepts a validly signed token", () => {
    const token = mintDevToken({ sub: "u1", tenantId: "t1", role: "administrator" });
    const session = requireWorkforceSession(makeRequest({ authorization: `Bearer ${token}` }));
    expect(session).toEqual({ userId: "u1", tenantId: "t1", role: "administrator" });
  });

  it("rejects a missing Authorization header", () => {
    expect(() => requireWorkforceSession(makeRequest({}))).toThrow(UnauthenticatedError);
  });

  it("rejects a tampered token", () => {
    const token = mintDevToken({ sub: "u1", tenantId: "t1", role: "administrator" });
    const tampered = token.slice(0, -2) + "xx";
    expect(() =>
      requireWorkforceSession(makeRequest({ authorization: `Bearer ${tampered}` })),
    ).toThrow(UnauthenticatedError);
  });

  it("rejects a token signed with a different secret", () => {
    const originalSecret = process.env["AUTH_JWT_SECRET"];
    process.env["AUTH_JWT_SECRET"] = "a-different-secret";
    const token = mintDevToken({ sub: "u1", tenantId: "t1", role: "administrator" });
    process.env["AUTH_JWT_SECRET"] = originalSecret;
    expect(() =>
      requireWorkforceSession(makeRequest({ authorization: `Bearer ${token}` })),
    ).toThrow(UnauthenticatedError);
  });
});

describe("verifyIngestionSignature", () => {
  it("accepts a correctly signed request", () => {
    const body = JSON.stringify({ score: 5 });
    const timestamp = Date.now();
    const nonce = `n-${timestamp}-a`;
    const signature = signIngestionRequest(body, timestamp, nonce);
    const request = makeRequest({
      "x-ingest-signature": signature,
      "x-ingest-source-system": "test-suite",
      "x-ingest-timestamp": String(timestamp),
      "x-ingest-nonce": nonce,
    });
    const result = verifyIngestionSignature(request, body);
    expect(result.sourceSystem).toBe("test-suite");
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ score: 5 });
    const timestamp = Date.now();
    const nonce = `n-${timestamp}-b`;
    const signature = signIngestionRequest(body, timestamp, nonce);
    const request = makeRequest({
      "x-ingest-signature": signature,
      "x-ingest-source-system": "test-suite",
      "x-ingest-timestamp": String(timestamp),
      "x-ingest-nonce": nonce,
    });
    expect(() => verifyIngestionSignature(request, JSON.stringify({ score: 10 }))).toThrow(
      UnauthenticatedError,
    );
  });

  it("rejects a replayed nonce", () => {
    const body = JSON.stringify({ score: 5 });
    const timestamp = Date.now();
    const nonce = `n-${timestamp}-c`;
    const signature = signIngestionRequest(body, timestamp, nonce);
    const request = makeRequest({
      "x-ingest-signature": signature,
      "x-ingest-source-system": "test-suite",
      "x-ingest-timestamp": String(timestamp),
      "x-ingest-nonce": nonce,
    });
    verifyIngestionSignature(request, body); // first use succeeds
    expect(() => verifyIngestionSignature(request, body)).toThrow(UnauthenticatedError); // replay rejected
  });

  it("rejects a timestamp outside the allowed window", () => {
    const body = JSON.stringify({ score: 5 });
    const staleTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes old
    const nonce = `n-${staleTimestamp}-d`;
    const signature = signIngestionRequest(body, staleTimestamp, nonce);
    const request = makeRequest({
      "x-ingest-signature": signature,
      "x-ingest-source-system": "test-suite",
      "x-ingest-timestamp": String(staleTimestamp),
      "x-ingest-nonce": nonce,
    });
    expect(() => verifyIngestionSignature(request, body)).toThrow(UnauthenticatedError);
  });
});
