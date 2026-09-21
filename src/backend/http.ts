/**
 * Shared HTTP helpers for API route handlers — error envelope per §6, requestId propagation,
 * and the private no-store cache header required for user/permission-dependent responses.
 */
import { randomUUID } from "node:crypto";
import type { ZodError } from "zod";
import type { ApiError } from "./contracts";

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function jsonOk(body: unknown, requestId: string, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "x-request-id": requestId,
      ...(init?.headers ?? {}),
    },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  opts?: { fieldErrors?: Record<string, string[] | undefined>; retryable?: boolean },
): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId,
      ...(opts?.fieldErrors ? { fieldErrors: opts.fieldErrors } : {}),
      retryable: opts?.retryable ?? false,
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "x-request-id": requestId,
    },
  });
}

/** Parses query params against a zod schema, returning a typed result or a 400 Response. */
export function parseQuery<T>(
  url: URL,
  schema: {
    safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: ZodError };
  },
  requestId: string,
): { ok: true; data: T } | { ok: false; response: Response } {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_query",
        "One or more query parameters are invalid.",
        requestId,
        {
          fieldErrors: result.error.flatten?.().fieldErrors,
        },
      ),
    };
  }
  return { ok: true, data: result.data };
}

export async function parseBody<T>(
  request: Request,
  schema: {
    safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: ZodError };
  },
  requestId: string,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId),
    };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(422, "invalid_body", "Request body failed validation.", requestId, {
        fieldErrors: result.error.flatten?.().fieldErrors,
      }),
    };
  }
  return { ok: true, data: result.data };
}
