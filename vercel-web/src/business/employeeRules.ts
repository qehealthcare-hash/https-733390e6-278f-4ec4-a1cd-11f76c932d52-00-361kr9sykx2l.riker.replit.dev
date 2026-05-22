import type { EmployeeInput, EmployeeStatus } from "@/validation/employeeValidation";
import { EMPLOYEE_STATUSES } from "@/validation/employeeValidation";
import { findPhoneDuplicate } from "@/business/phoneRules";
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
    aadhar: i.aadhar || "",
    pan: i.pan || "",
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
    leave_date: leaveDateForStatus(
      input.status,
      input.leave_date || input.leave || ""
    ),
    docs: (input.docs ?? i.documents) ?? undefined,
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
    gender: row.gender || "",
    dob: row.dob || "",
    area: row.area || "",
    presaddr: row.presaddr || row.permaddr || "",
    pin: row.pin || "",
    department: row.dept || "",
    designation: row.desig || "",
    role: row.desig || "",
    employee_type: row.emp_type || row.etype || "",
    shift: row.shift || "",
    shift_type: row.shift || "",
    salary: Number(row.salary || 0),
    join_date: row.join_date || row.join || null,
    leave_date: row.leave_date || row.leave || null,
    status,
    active: isActiveEmployee(row),
    ecname: row.ecname || "",
    ecphone: row.ecphone || "",
    docs: row.docs || [],
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

/** Patch to deactivate (soft-delete) an employee. */
export function deactivatePatch(actorEmail: string, _reason = "") {
  return {
    leave_date: new Date().toISOString().slice(0, 10),
    updated_by: actorEmail
  };
}

/** Patch to (re)activate. */
export function activatePatch(actorEmail: string) {
  return {
    leave_date: "",
    updated_by: actorEmail
  };
}

/** Patch for arbitrary status change (used by /status route). */
export function statusPatch(status: EmployeeStatus, actorEmail: string, _reason = "") {
  if (status === "Inactive") return deactivatePatch(actorEmail);
  if (status === "Active") return activatePatch(actorEmail);
  return {
    leave_date: leaveDateForStatus(status),
    updated_by: actorEmail
  };
}
