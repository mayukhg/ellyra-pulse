/**
 * Real JWT-based workforce authentication (§9.3: dashboard viewer, customer-success operator,
 * clinical-safety reviewer, administrator; tenant scoping) plus signed-request verification for
 * the machine-to-machine ingestion endpoint (§5.7).
 *
 * This replaces the earlier header-trusting stub with actual cryptographic verification, but it
 * is still not a real identity provider: there's no user directory, no token issuance flow
 * beyond the dev-only minting script, and no revocation. Wiring this to the real workforce IdP
 * (Phase 2 of docs/README's roadmap) means replacing `mintDevToken`/local verification with
 * whatever the IdP's token format and JWKS endpoint require — `requireWorkforceSession`'s
 * signature (throws Unauthenticated/Unauthorised, returns a WorkforceSession) shouldn't need to
 * change.
 */
import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "node:crypto";

export type WorkforceRole =
  "dashboard_viewer" | "customer_success" | "clinical_safety" | "administrator";

export interface WorkforceSession {
  /** Must be a UUID when running against the Postgres repository — fact_closed_loop_ticket's
   * owner_id/last_updated_by columns are `uuid` per db/migrations/0001_init.sql. A real
   * workforce IdP's `sub` claim (username/email) would need mapping to an internal UUID before
   * reaching here; the in-memory repository has no such constraint. */
  userId: string;
  tenantId: string;
  role: WorkforceRole;
}

export class UnauthenticatedError extends Error {}
export class UnauthorisedError extends Error {}

const VALID_ROLES: WorkforceRole[] = [
  "dashboard_viewer",
  "customer_success",
  "clinical_safety",
  "administrator",
];

function getJwtSecret(): string {
  const secret = process.env["AUTH_JWT_SECRET"];
  if (!secret) {
    throw new Error(
      "AUTH_JWT_SECRET is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and set it before starting the app.",
    );
  }
  return secret;
}

interface WorkforceClaims {
  sub: string;
  tenantId: string;
  role: WorkforceRole;
}

/** Dev-only helper for minting a session token — see scripts/mint-dev-token.mjs. Never expose
 * this as an HTTP endpoint; it exists so local development and the validation suite don't need a
 * real identity provider. */
export function mintDevToken(
  claims: WorkforceClaims,
  expiresIn: jwt.SignOptions["expiresIn"] = "12h",
): string {
  return jwt.sign(claims, getJwtSecret(), { expiresIn, algorithm: "HS256" });
}

export function requireWorkforceSession(request: Request): WorkforceSession {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthenticatedError(
      "Missing or malformed Authorization header (expected 'Bearer <token>').",
    );
  }
  const token = authHeader.slice("Bearer ".length);

  let payload: WorkforceClaims;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as WorkforceClaims;
  } catch (err) {
    throw new UnauthenticatedError(`Invalid or expired session token: ${(err as Error).message}`);
  }

  if (!payload.sub || !payload.tenantId || !payload.role) {
    throw new UnauthenticatedError(
      "Session token is missing required claims (sub, tenantId, role).",
    );
  }
  if (!VALID_ROLES.includes(payload.role)) {
    throw new UnauthorisedError(`Unknown role: ${payload.role}`);
  }
  return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
}

export function requireRole(session: WorkforceSession, allowed: WorkforceRole[]) {
  if (!allowed.includes(session.role) && session.role !== "administrator") {
    throw new UnauthorisedError(`Role ${session.role} cannot perform this action.`);
  }
}

// ---------------------------------------------------------------------------
// Signed ingestion credential (§5.7): HMAC-SHA256 over timestamp.nonce.body,
// a bounded timestamp window, and single-use nonce replay protection.
// ---------------------------------------------------------------------------

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const seenNonces = new Map<string, number>(); // nonce -> expiry epoch ms

function pruneExpiredNonces(now: number) {
  for (const [nonce, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(nonce);
  }
}

function getIngestSecret(): string {
  const secret = process.env["INGEST_HMAC_SECRET"];
  if (!secret) {
    throw new Error(
      "INGEST_HMAC_SECRET is not set. Generate one the same way as AUTH_JWT_SECRET and set it before starting the app.",
    );
  }
  return secret;
}

/**
 * Verifies the signed ingestion request. Must be called with the exact raw body bytes the
 * signature was computed over — do not call request.json() first, since re-serializing would
 * not reproduce the original bytes.
 */
export function verifyIngestionSignature(
  request: Request,
  rawBody: string,
): { sourceSystem: string } {
  const signature = request.headers.get("x-ingest-signature");
  const sourceSystem = request.headers.get("x-ingest-source-system");
  const timestampHeader = request.headers.get("x-ingest-timestamp");
  const nonce = request.headers.get("x-ingest-nonce");

  if (!signature || !sourceSystem || !timestampHeader || !nonce) {
    throw new UnauthenticatedError(
      "Missing signed ingestion credential (require x-ingest-signature, x-ingest-source-system, x-ingest-timestamp, x-ingest-nonce).",
    );
  }

  const timestamp = Number(timestampHeader);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) {
    throw new UnauthenticatedError("Ingestion request timestamp is outside the allowed window.");
  }

  pruneExpiredNonces(now);
  if (seenNonces.has(nonce)) {
    throw new UnauthenticatedError("Ingestion request nonce has already been used (replay).");
  }

  const expected = createHmac("sha256", getIngestSecret())
    .update(`${timestampHeader}.${nonce}.${rawBody}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new UnauthenticatedError("Ingestion signature does not match.");
  }

  seenNonces.set(nonce, now + SIGNATURE_WINDOW_MS);
  return { sourceSystem };
}

/** Signs a request body the same way verifyIngestionSignature expects — used by the validation
 * suite and available for real ingestion clients to mirror. */
export function signIngestionRequest(rawBody: string, timestamp: number, nonce: string): string {
  return createHmac("sha256", getIngestSecret())
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest("hex");
}
