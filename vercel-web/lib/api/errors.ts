import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = "api_error", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown) {
  return new ApiError(400, message, "bad_request", details);
}
export function unauthorized(message = "Sign in required") {
  return new ApiError(401, message, "unauthorized");
}
export function forbidden(message = "Forbidden") {
  return new ApiError(403, message, "forbidden");
}
export function notFound(entity = "Resource") {
  return new ApiError(404, `${entity} not found`, "not_found");
}
export function conflict(message: string, details?: unknown) {
  return new ApiError(409, message, "conflict", details);
}
export function serverError(message = "Internal server error", details?: unknown) {
  return new ApiError(500, message, "internal_error", details);
}

/**
 * Canonical API error envelope (Phase 6).
 * All `/api/v1/*` routes return `{ success, data?, error?, details?, code? }`.
 */
export function jsonError(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: "Validation failed",
        code: "validation_error",
        details: err.flatten()
      },
      { status: 422 }
    );
  }
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: err.message,
        code: err.code,
        details: err.details ?? null
      },
      { status: err.status }
    );
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[api] unhandled", err);
  return NextResponse.json(
    { success: false, error: message, code: "internal_error" },
    { status: 500 }
  );
}

/** Success envelope — prefer `respond(success(data))` from services. */
export function jsonOk<T>(data: T, init?: number | { status?: number; headers?: Record<string, string> }) {
  const status = typeof init === "number" ? init : init?.status ?? 200;
  const headers = typeof init === "number" ? undefined : init?.headers;
  return NextResponse.json({ success: true, data }, { status, headers });
}
