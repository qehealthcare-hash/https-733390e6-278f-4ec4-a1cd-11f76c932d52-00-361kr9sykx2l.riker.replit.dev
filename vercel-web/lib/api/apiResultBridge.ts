/**
 * Bridge between layered services that return `ApiResult<T>` and the legacy
 * `{ ok, data, message, code, details }` envelope produced by `jsonOk` /
 * `jsonError`. Lets us migrate route-by-route without breaking existing
 * `lib/api-client.js` callers.
 */

import type { NextResponse } from "next/server";
import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { ApiError, jsonError, jsonOk } from "@/lib/api/errors";

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
    default:
      return 500;
  }
}

/** Convert an ApiResult into a legacy-envelope Next response. */
export function respondLegacy<T>(
  result: ApiResult<T>,
  successStatus = 200
): NextResponse {
  if (result.success) {
    return jsonOk(result.data as T, successStatus);
  }
  return jsonError(
    new ApiError(
      statusFor(result.code),
      result.error || "Request failed",
      result.code || ErrorCodes.internal,
      result.details
    )
  );
}

/**
 * Throw `ApiError` on failure, otherwise return `result.data`.
 *
 * Lets old throw-based callers in `lib/api/services/*.ts` consume the new
 * `ApiResult`-returning services without rewriting their control flow.
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
