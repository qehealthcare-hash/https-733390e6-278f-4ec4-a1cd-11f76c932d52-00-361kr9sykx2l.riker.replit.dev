import type { EmployeeInput, EmployeeStatus } from "@/validation/employeeValidation";
import { EMPLOYEE_STATUSES } from "@/validation/employeeValidation";
import { findPhoneDuplicate, phoneDigitsKey } from "@/business/phoneRules";
import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";

export { EMPLOYEE_STATUSES };
export type { EmployeeStatus };

const ACTIVE_STATUSES = new Set<EmployeeStatus>(["Active"]);

export function employeeFullName(parts: { fn?: string; mn?: string; ln?: string }): string {
  return [parts.fn, parts.mn, parts.ln].filter(Boolean).join(" ").trim();
}

/** Derive API status from DB row (status column or legacy leave_date marker). */
export function employeeStatusFromRow(row: {
  status?: string | null;
  leave_date?: string | null;
}): EmployeeStatus {
  const explicit = String(row.status || "").trim();
  if (explicit && (EMPLOYEE_STATUSES as readonly string[]).includes(explicit)) {
    return explicit as EmployeeStatus;
  }
  const leave = String(row.leave_date || "").trim();
  return leave ? "Inactive" : "Active";
}

export function isActiveEmployee(
  statusOrRow: string | { status?: string | null; leave_date?: string | null } | null | undefined
): boolean {
  if (statusOrRow && typeof statusOrRow === "object") {
    return employeeStatusFromRow(statusOrRow) === "Active";
  }
  return ACTIVE_STATUSES.has((statusOrRow || "Active") as EmployeeStatus);
}

function leaveDateForStatus(status: EmployeeStatus, existing?: string | null): string {
  if (status === "Active") return "";
  if (existing) return existing;
  return new Date().toISOString().slice(0, 10);
}

/** DB row shape — only columns that exist on production `hh_employees`. */
export function employeeToRow(input: EmployeeInput) {
  const i = input as EmployeeInput & {
    phone2?: string;
    blood?: string;
    address?: string;
    district?: string;
    state?: string;
    edu?: string;
    education?: string;
    exp?: string;
    company?: string;
    aadhar?: string;
    pan?: string;
    permaddr?: string;
    permpin?: string;
    permdist?: string;
    permstate?: string;
    presaddr?: string;
    prespin?: string;
    presdist?: string;
    presstate?: string;
    ecname?: string;
    ecphone?: string;
    ecrel?: string;
    refname?: string;
    refphone?: string;
    skills?: string;
    photo?: unknown;
    documents?: unknown;
  };
  const row: Record<string, unknown> = {
    fn: input.fn,
    mn: input.mn,
    ln: input.ln,
    phone: input.phone,
    phone2: i.phone2 || "",
    email: input.email || "",
    gender: input.gender,
    dob: input.dob,
    blood: i.blood || "",
    area: input.area,
    pin: input.pin,
    district: i.district || "",
    state: i.state || "",
    dept: input.dept,
    desig: input.desig,
    emp_type: input.emp_type,
    etype: input.etype,
    shift: input.shift,
    edu: i.edu || i.education || "",
    exp: i.exp || "",
    company: i.company || "",
    aadhar: normalizeAadhar(i.aadhar) || "",
    pan: String(i.pan || "")
      .trim()
      .toUpperCase(),
    permaddr: i.permaddr || "",
    permpin: i.permpin || "",
    permdist: i.permdist || "",
    permstate: i.permstate || "",
    presaddr: i.presaddr || "",
    prespin: i.prespin || "",
    presdist: i.presdist || "",
    presstate: i.presstate || "",
    ecname: i.ecname || "",
    ecphone: i.ecphone || "",
    ecrel: i.ecrel || "",
    refname: i.refname || i.ecname || "",
    refphone: i.refphone || i.ecphone || "",
    skills: i.skills || "",
    salary: input.salary != null ? String(input.salary) : "",
    join_date: input.join_date || input.join || "",
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.status != null
      ? {
          leave_date: leaveDateForStatus(input.status, input.leave_date || input.leave || "")
        }
      : {}),
    docs: (input.docs ?? i.documents) ?? undefined,
    name_key: employeeNameKey(input),
    phone_digits: phoneDigitsKey(input.phone),
    ...(Object.prototype.hasOwnProperty.call(i, "photo")
      ? { photo: i.photo ?? null }
      : {}),
    score_experience: input.score_experience ?? null,
    score_behaviour: input.score_behaviour ?? null,
    score_testimonial: input.score_testimonial ?? null,
    score_total: input.score_total ?? null,
    updated_by: undefined
  };
  return row;
}

/** Outbound shape — single contract for legacy + React clients. */
export function employeeToApi(row: Record<string, unknown>) {
  if (!row) return row;
  const full = employeeFullName({
    fn: String(row.fn || ""),
    mn: String(row.mn || ""),
    ln: String(row.ln || "")
  });
  const status = employeeStatusFromRow(row);
  return {
    id: row.id,
    full_name: full,
    name: full,
    fn: row.fn || "",
    mn: row.mn || "",
    ln: row.ln || "",
    phone: row.phone || "",
    mobile: row.phone || "",
    email: row.email || "",
    phone2: row.phone2 || "",
    gender: row.gender || "",
    dob: row.dob || "",
    blood: row.blood || "",
    area: row.area || "",
    // Keep permaddr / presaddr separate on read (aliasing breaks clearing blanks).
    permaddr: row.permaddr || "",
    presaddr: row.presaddr || "",
    addr: row.permaddr || row.presaddr || "",
    address: row.permaddr || row.presaddr || "",
    pin: row.pin || "",
    pincode: row.pin || "",
    district: row.district || "",
    state: row.state || "",
    aadhar: row.aadhar || "",
    pan: row.pan || "",
    dept: row.dept || "",
    department: row.dept || "",
    designation: row.desig || "",
    desig: row.desig || "",
    role: row.desig || "",
    employee_type: row.emp_type || row.etype || "",
    emp_type: row.emp_type || row.etype || "",
    etype: row.etype || row.emp_type || "",
    education: row.edu || "",
    edu: row.edu || "",
    exp: row.exp || "",
    company: row.company || "",
    shift: row.shift || "",
    shift_type: row.shift || "",
    salary: Number(row.salary || 0),
    join_date: row.join_date || row.join || null,
    leave_date: row.leave_date || row.leave || null,
    status,
    active: isActiveEmployee(row),
    ecname: row.ecname || "",
    ecphone: row.ecphone || "",
    ecrel: row.ecrel || "",
    relname: row.ecname || "",
    relphone: row.ecphone || "",
    skills: row.skills || "",
    docs: row.docs || [],
    employee_documents: row.docs || [],
    photo: row.photo && typeof row.photo === "object" ? row.photo : null,
    score_experience: row.score_experience != null ? Number(row.score_experience) : null,
    score_behaviour: row.score_behaviour != null ? Number(row.score_behaviour) : null,
    score_testimonial: row.score_testimonial != null ? Number(row.score_testimonial) : null,
    score_total: row.score_total != null ? Number(row.score_total) : null,
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

/** Find an active employee that already uses this mobile (last 8 digits match). */
export function findActiveEmployeeDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null; leave_date?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isActiveEmployee(r)
  });
}

/** Normalised name key for duplicate detection (case / whitespace insensitive). */
export function employeeNameKey(parts: {
  fn?: string | null;
  mn?: string | null;
  ln?: string | null;
  name?: string | null;
  full_name?: string | null;
}): string {
  const explicit = String(parts.name || parts.full_name || "").trim();
  const built =
    explicit ||
    employeeFullName({
      fn: parts.fn ?? undefined,
      mn: parts.mn ?? undefined,
      ln: parts.ln ?? undefined
    });
  return built.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findActiveEmployeeByName<
  T extends {
    id: string;
    fn?: string | null;
    mn?: string | null;
    ln?: string | null;
    name?: string | null;
    full_name?: string | null;
    phone?: string | null;
    status?: string | null;
    leave_date?: string | null;
  }
>(
  candidates: T[],
  parts: { fn?: string; mn?: string; ln?: string; name?: string; full_name?: string },
  excludeId?: string
): T | null {
  const key = employeeNameKey(parts);
  if (!key) return null;
  for (const c of candidates) {
    if (excludeId && String(c.id) === excludeId) continue;
    if (!isActiveEmployee(c)) continue;
    if (employeeNameKey(c) === key) return c;
  }
  return null;
}

/** Digits-only Aadhar (12) for identity checks. */
export function normalizeAadhar(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

export function findActiveEmployeeByAadhar<
  T extends {
    id: string;
    aadhar?: string | null;
    status?: string | null;
    leave_date?: string | null;
  }
>(candidates: T[], aadhar: string, excludeId?: string): T | null {
  const key = normalizeAadhar(aadhar);
  if (key.length !== 12) return null;
  for (const c of candidates) {
    if (excludeId && String(c.id) === excludeId) continue;
    if (!isActiveEmployee(c)) continue;
    if (normalizeAadhar(c.aadhar) === key) return c;
  }
  return null;
}

/** Counts of historical references that should prevent hard deletion. */
export interface EmployeeLinkCounts {
  duties: number;
  attendance: number;
  payouts: number;
  caretakerOf: number;
}

export function totalEmployeeLinks(c: EmployeeLinkCounts): number {
  return c.duties + c.attendance + c.payouts + c.caretakerOf;
}

/**
 * If the employee touches historical data (duties/attendance/payouts/patient assignment),
 * we MUST NOT hard delete. Caller should deactivate instead.
 */
export function ensureNoHistoricalLinks(counts: EmployeeLinkCounts): ApiResult<null> {
  if (totalEmployeeLinks(counts) > 0) {
    return businessFailure(
      "Employee has historical records; deactivate instead of deleting",
      { counts }
    );
  }
  return businessOk();
}

/**
 * Only Active employees accept full profile PATCH. Inactive / OnLeave /
 * Suspended rows must be changed via PATCH /employees/:id/status (or
 * re-activate) so lifecycle transitions stay auditable.
 */
export function canEditEmployee(
  statusOrRow: string | { status?: string | null; leave_date?: string | null } | null | undefined
): ApiResult<null> {
  if (!isActiveEmployee(statusOrRow)) {
    const label =
      typeof statusOrRow === "object" && statusOrRow
        ? employeeStatusFromRow(statusOrRow)
        : String(statusOrRow || "Inactive");
    return businessFailure(
      `${label} employees are read-only — use Change Status or re-activate before editing the profile`
    );
  }
  return businessOk();
}

/** Patch to deactivate (soft-delete) an employee. */
export function deactivatePatch(actorEmail: string, _reason = "") {
  return {
    status: "Inactive" as const,
    leave_date: new Date().toISOString().slice(0, 10),
    updated_by: actorEmail
  };
}

/** Patch to (re)activate. */
export function activatePatch(actorEmail: string) {
  return {
    status: "Active" as const,
    leave_date: "",
    updated_by: actorEmail
  };
}

/**
 * Patch for arbitrary status change (used by /status route). Persists both
 * the explicit `status` column (added in migration 022) AND the legacy
 * `leave_date` column so older readers / reports stay consistent:
 *
 *   - Active                  → status='Active',   leave_date=''
 *   - Inactive                → status='Inactive', leave_date=today (or existing)
 *   - OnLeave / Suspended     → status=<picked>,   leave_date=today (HR off-roster)
 *                               so duty / payout queries that filter by
 *                               leave_date still treat them as off-roster.
 */
export function statusPatch(status: EmployeeStatus, actorEmail: string, _reason = "") {
  if (status === "Active") return activatePatch(actorEmail);
  if (status === "Inactive") return deactivatePatch(actorEmail);
  return {
    status,
    leave_date: leaveDateForStatus(status),
    updated_by: actorEmail
  };
}
