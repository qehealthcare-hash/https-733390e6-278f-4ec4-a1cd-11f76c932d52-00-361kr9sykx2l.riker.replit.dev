/**
 * Shared cross-layer types for the Hominal CRM.
 *
 * Every service/business/database/validation function must return an
 * `ApiResult<T>`. Never return raw rows or throw on expected failures.
 */

/** Canonical response envelope used by services, business, and API routes. */
export interface ApiResult<T = unknown> {
  success: boolean;
  /** Present on success. */
  data?: T;
  /** Short human-readable summary when success === false. */
  error?: string;
  /**
   * Machine-readable extra context. Examples:
   *   - validation issues: ZodError.flatten() result
   *   - duplicate-record info: { field: "phone", value: "..." }
   *   - upstream HTTP status: { status: 502 }
   */
  details?: unknown;
  /**
   * Stable error code for client routing (e.g. "validation_error",
   * "duplicate", "not_found"). Only set when success === false.
   */
  code?: string;
}

/** Allowed roles in the Hominal CRM RBAC catalog. */
export type AppRole =
  | "Admin"
  | "Manager"
  | "Accountant"
  | "Supervisor"
  | "Executive"
  | "Nurse"
  | "Attendant"
  | "Doctor"
  | "Account"
  | "Caretaker";

/**
 * @deprecated Use `ServiceActor` from `@/types/serviceActor` instead.
 *
 * This older shape pre-dates the layered architecture and is no longer
 * used by any service or repository — it survives only for a small number
 * of external consumers that import the public type surface. New code
 * must import `ServiceActor`.
 */
export interface Actor {
  /** Supabase auth uid */
  id: string;
  /** Lowercased email or username */
  email: string;
  /** Role from hh_app_users.role (RBAC catalog). */
  role: AppRole | string;
}

/** Pagination request shape used by list services. */
export interface PageRequest {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/** Pagination response envelope. */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** ISO-8601 timestamp (UTC). */
export type IsoTimestamp = string;

/** ISO calendar date (YYYY-MM-DD). */
export type IsoDate = string;

/** Money amount in INR (integer rupees, never paise). */
export type Money = number;

/** Audit-log record shape for hh_audit_logs. */
export interface AuditEntry {
  module: string;
  action: "create" | "update" | "delete" | "view" | string;
  recordId: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: string;
  at?: IsoTimestamp;
}

/** Standard error codes the client may switch on. */
export const ErrorCodes = {
  validation: "validation_error",
  badRequest: "bad_request",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
  duplicate: "duplicate",
  conflict: "conflict",
  database: "database_error",
  upstream: "upstream_error",
  business: "business_rule_violation",
  audit: "audit_write_failed",
  internal: "internal_error"
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {});
