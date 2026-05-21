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

export function jsonError(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { ok: false, code: "validation_error", message: "Validation failed", details: err.flatten() },
      { status: 422 }
    );
  }
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, code: err.code, message: err.message, details: err.details ?? null },
      { status: err.status }
    );
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[api] unhandled", err);
  return NextResponse.json({ ok: false, code: "internal_error", message }, { status: 500 });
}

export function jsonOk<T>(data: T, init?: number | { status?: number; headers?: Record<string, string> }) {
  if (typeof init === "number") {
    return NextResponse.json({ ok: true, data }, { status: init });
  }
  return NextResponse.json({ ok: true, data }, init);
}
