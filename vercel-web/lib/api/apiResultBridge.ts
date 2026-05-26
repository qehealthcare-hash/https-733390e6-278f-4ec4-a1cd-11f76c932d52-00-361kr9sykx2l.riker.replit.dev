/**
 * Bridge between layered services (`ApiResult<T>`) and HTTP responses.
 *
 * Phase 6: every route returns the canonical envelope:
 *   `{ success: boolean, data?, error?, details?, code? }`
 *
 * Use `respond(result)` in route handlers. Use `unwrap(result)` only in
 * legacy `@deprecated` lib/api/services shims.
 */

import type { NextResponse } from "next/server";
import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { ApiError } from "@/lib/api/errors";
import { toNextResponse } from "@/utils/apiResponse";

function statusFor(code: string | undefined): number {
  switch (code) {
    case ErrorCodes.validation:
    case ErrorCodes.business:
      return 422;
    case ErrorCodes.badRequest:
      return 400;
    case ErrorCodes.unauthorized:
      return 401;
    case ErrorCodes.forbidden:
      return 403;
    case ErrorCodes.notFound:
      return 404;
    case ErrorCodes.duplicate:
    case ErrorCodes.conflict:
      return 409;
    case ErrorCodes.upstream:
      return 502;
    case ErrorCodes.audit:
      return 503;
    default:
      return 500;
  }
}

/**
 * Convert an `ApiResult<T>` into a Next.js Response with the canonical envelope.
 */
export function respond<T>(result: ApiResult<T>, successStatus = 200): NextResponse {
  if (result.success) {
    return toNextResponse(result, { status: successStatus });
  }
  return toNextResponse(result);
}

/** @deprecated Alias for `respond` — same canonical envelope. */
export const respondLegacy = respond;

/**
 * Throw `ApiError` on failure, otherwise return `result.data`.
 *
 * Reserved for the rare integration that must bridge an `ApiResult` to
 * legacy throw-based callers (e.g. external scripts). New code in routes
 * and services should use `respond()` and return ApiResult directly.
 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (result.success) return result.data as T;
  throw new ApiError(
    statusFor(result.code),
    result.error || "Request failed",
    result.code || ErrorCodes.internal,
    result.details
  );
}
