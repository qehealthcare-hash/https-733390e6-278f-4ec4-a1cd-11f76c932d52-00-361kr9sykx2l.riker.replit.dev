/**
 * Centralized error handling for the new architecture.
 *
 * Two layers:
 *   1. `AppError` — typed business / database / validation errors that services
 *      may throw OR return as ApiResult failures.
 *   2. `wrapRoute()` — Next.js route handler wrapper. Catches anything that
 *      escaped a service, converts it to the canonical envelope, and returns
 *      a NextResponse. Never let an uncaught error reach the runtime.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiResult, ErrorCode } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { failure, toNextResponse } from "@/utils/apiResponse";

/** Typed error class — services prefer to RETURN failures, but may throw this. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly httpStatus: number;
  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

/** Helpers to throw with the right code + status. */
export const AppErrors = {
  validation(message = "Validation failed", details?: unknown) {
    return new AppError(ErrorCodes.validation, message, 422, details);
  },
  badRequest(message: string, details?: unknown) {
    return new AppError(ErrorCodes.badRequest, message, 400, details);
  },
  unauthorized(message = "Sign in required") {
    return new AppError(ErrorCodes.unauthorized, message, 401);
  },
  forbidden(message = "Forbidden") {
    return new AppError(ErrorCodes.forbidden, message, 403);
  },
  notFound(entity = "Resource") {
    return new AppError(ErrorCodes.notFound, `${entity} not found`, 404, { entity });
  },
  duplicate(field: string, value: unknown, message?: string) {
    return new AppError(
      ErrorCodes.duplicate,
      message || `Duplicate ${field}`,
      409,
      { field, value }
    );
  },
  conflict(message: string, details?: unknown) {
    return new AppError(ErrorCodes.conflict, message, 409, details);
  },
  database(message: string, details?: unknown) {
    return new AppError(ErrorCodes.database, message, 500, details);
  },
  upstream(message: string, status = 502, details?: unknown) {
    return new AppError(ErrorCodes.upstream, message, status, details);
  },
  business(message: string, details?: unknown) {
    return new AppError(ErrorCodes.business, message, 422, details);
  },
  internal(message = "Internal server error", details?: unknown) {
    return new AppError(ErrorCodes.internal, message, 500, details);
  }
};

/** Normalize any thrown value into an ApiResult failure. */
export function toApiResult(err: unknown): ApiResult<never> {
  if (err instanceof ZodError) {
    return {
      success: false,
      error: "Validation failed",
      code: ErrorCodes.validation,
      details: err.flatten()
    };
  }
  if (err instanceof AppError) {
    return {
      success: false,
      error: err.message,
      code: err.code,
      details: err.details
    };
  }
  if (err instanceof Error) {
    return failure(err.message || "Internal error", ErrorCodes.internal);
  }
  return failure("Internal error", ErrorCodes.internal);
}

/** Pick the right HTTP status for an unknown thrown value. */
export function httpStatusFor(err: unknown): number {
  if (err instanceof AppError) return err.httpStatus;
  if (err instanceof ZodError) return 422;
  return 500;
}

/**
 * Wrap a Next.js Route Handler so anything that escapes is converted into the
 * canonical envelope and an appropriate HTTP status. Usage:
 *
 *   export const POST = wrapRoute(async (req) => {
 *     const result = await patientService.create(input);
 *     return result; // ApiResult<T>
 *   });
 */
export function wrapRoute<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<ApiResult<unknown> | NextResponse>
) {
  return async (...args: TArgs): Promise<NextResponse> => {
    try {
      const result = await handler(...args);
      if (result instanceof NextResponse) return result;
      return toNextResponse(result);
    } catch (err) {
      const status = httpStatusFor(err);
      const body = toApiResult(err);
      if (!(err instanceof AppError) && !(err instanceof ZodError)) {
        // Only log truly unexpected errors. AppError / ZodError are
        // already-classified and not a sign of a server bug.
        // eslint-disable-next-line no-console
        console.error("[wrapRoute] unhandled error", err);
      }
      return NextResponse.json(body, { status });
    }
  };
}

/** Log an audit-relevant failure without leaking secrets. */
export function logServiceError(scope: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${scope}]`, err instanceof Error ? err.message : err);
}
