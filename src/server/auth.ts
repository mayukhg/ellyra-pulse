/**
 * Auth stub — §9.3 least-privilege roles (dashboard viewer, customer-success operator,
 * clinical-safety reviewer, administrator) and tenant scoping.
 *
 * TODO: replace with the real workforce identity provider. This scaffold trusts request headers
 * so the API routes and their permission checks can be built and tested now; it must not reach
 * production as-is.
 */
export type WorkforceRole = "dashboard_viewer" | "customer_success" | "clinical_safety" | "administrator";

export interface WorkforceSession {
  userId: string;
  tenantId: string;
  role: WorkforceRole;
}

export class UnauthenticatedError extends Error {}
export class UnauthorisedError extends Error {}

export function requireWorkforceSession(request: Request): WorkforceSession {
  const userId = request.headers.get("x-workforce-user-id");
  const tenantId = request.headers.get("x-workforce-tenant-id");
  const role = request.headers.get("x-workforce-role") as WorkforceRole | null;

  if (!userId || !tenantId || !role) {
    throw new UnauthenticatedError("Missing workforce session headers.");
  }
  const validRoles: WorkforceRole[] = ["dashboard_viewer", "customer_success", "clinical_safety", "administrator"];
  if (!validRoles.includes(role)) {
    throw new UnauthorisedError(`Unknown role: ${role}`);
  }
  return { userId, tenantId, role };
}

export function requireRole(session: WorkforceSession, allowed: WorkforceRole[]) {
  if (!allowed.includes(session.role) && session.role !== "administrator") {
    throw new UnauthorisedError(`Role ${session.role} cannot perform this action.`);
  }
}

/** Verifies the signed machine-to-machine credential for POST /api/v1/responses/ingest. */
export function requireIngestionCredential(request: Request): { sourceSystem: string } {
  const signature = request.headers.get("x-ingest-signature");
  const sourceSystem = request.headers.get("x-ingest-source-system");
  if (!signature || !sourceSystem) {
    throw new UnauthenticatedError("Missing signed ingestion credential.");
  }
  // TODO: verify HMAC signature, timestamp window, and nonce replay protection per §5.7.
  return { sourceSystem };
}
