/**
 * Canonical {success, data, error, details, code} response helpers.
 *
 * Use these from every NEW service in /src/services and every new API route.
 * The legacy `/lib/api/errors.ts` returns `{ok, data, message, ...}` — convert
 * with `fromLegacyEnvelope()` when bridging.
 */

import { NextResponse } from "next/server";
import type { ApiResult, ErrorCode } from "@/types/common";
import { ErrorCodes } from "@/types/common";

/** Build a successful ApiResult<T>. */
export function success<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

/** Build a failed ApiResult. */
export function failure(
  error: string,
  code: ErrorCode = ErrorCodes.internal,
  details?: unknown
): ApiResult<never> {
  const out: ApiResult<never> = { success: false, error, code };
  if (details !== undefined) out.details = details;
  return out;
}

/** Convenience: tag a database / Supabase error. */
export function dbFailure(error: string, details?: unknown): ApiResult<never> {
  return failure(error || "Database error", ErrorCodes.database, details);
}

/** Convenience: validation failure (Zod flatten result goes in details). */
export function validationFailure(details: unknown, error = "Validation failed"): ApiResult<never> {
  return failure(error, ErrorCodes.validation, details);
}

/** Convenience: duplicate / unique-constraint failure. */
export function duplicateFailure(field: string, value: unknown, error?: string): ApiResult<never> {
  return failure(
    error || `Duplicate ${field}`,
    ErrorCodes.duplicate,
    { field, value }
  );
}

/** Convenience: not-found failure. */
export function notFoundFailure(entity: string, idOrQuery?: unknown): ApiResult<never> {
  return failure(`${entity} not found`, ErrorCodes.notFound, idOrQuery !== undefined ? { entity, query: idOrQuery } : undefined);
}

/** Map an ApiResult<T> to the appropriate HTTP status. */
function httpStatusForResult(result: ApiResult<unknown>): number {
  if (result.success) return 200;
  switch (result.code) {
    case ErrorCodes.validation: return 422;
    case ErrorCodes.badRequest: return 400;
    case ErrorCodes.unauthorized: return 401;
    case ErrorCodes.forbidden: return 403;
    case ErrorCodes.notFound: return 404;
    case ErrorCodes.duplicate: return 409;
    case ErrorCodes.conflict: return 409;
    case ErrorCodes.business: return 422;
    case ErrorCodes.upstream: return 502;
    case ErrorCodes.audit: return 503;
    default: return 500;
  }
}

/** Convert an ApiResult<T> into a Next.js Response. */
export function toNextResponse<T>(
  result: ApiResult<T>,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  const status = init?.status ?? httpStatusForResult(result);
  return NextResponse.json(result, { status, headers: init?.headers });
}

/**
 * Bridge helper for routes still using the legacy `{ok, data, message, ...}`
 * envelope from /lib/api/errors.ts. Returns the canonical {success,...} shape.
 */
export function fromLegacyEnvelope(legacy: {
  ok?: boolean;
  data?: unknown;
  message?: string;
  code?: string;
  details?: unknown;
}): ApiResult<unknown> {
  if (legacy.ok) return { success: true, data: legacy.data };
  return {
    success: false,
    error: legacy.message || "Error",
    code: legacy.code || ErrorCodes.internal,
    details: legacy.details
  };
}

/** Type guard for ApiResult.success === true. */
export function isOk<T>(result: ApiResult<T>): result is ApiResult<T> & { success: true; data: T } {
  return result.success === true && result.data !== undefined;
}

/**
 * Re-type a failed ApiResult so it satisfies a different `T`. Use this when a
 * downstream call returns `ApiResult<X>` but the outer signature is
 * `ApiResult<Y>` — early-return shortcut without `as` casts everywhere.
 *
 * Caller is responsible for ensuring `result.success === false` before calling.
 */
export function passFailure<T>(result: ApiResult<unknown>): ApiResult<T> {
  return {
    success: false,
    error: result.error,
    code: result.code,
    details: result.details
  };
}
