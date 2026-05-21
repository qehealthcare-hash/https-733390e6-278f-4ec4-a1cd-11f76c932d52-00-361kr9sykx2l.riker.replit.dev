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

export function isActiveEmployee(status: string | undefined | null): boolean {
  return ACTIVE_STATUSES.has((status || "Active") as EmployeeStatus);
}

/** DB row shape — keeps only known `hh_employees` columns. */
export function employeeToRow(input: EmployeeInput) {
  return {
    fn: input.fn,
    mn: input.mn,
    ln: input.ln,
    phone: input.phone,
    email: input.email || "",
    gender: input.gender,
    dob: input.dob,
    addr: input.addr,
    area: input.area,
    city: input.city,
    pin: input.pin,
    dept: input.dept,
    desig: input.desig,
    emp_type: input.emp_type,
    etype: input.etype,
    shift: input.shift,
    salary: input.salary,
    status: input.status,
    join_date: input.join_date || input.join || null,
    leave_date: input.leave_date || input.leave || null,
    relname: input.relname,
    relphone: input.relphone,
    docs: input.docs ?? undefined
  };
}

/** Outbound shape — single contract for legacy + React clients. */
export function employeeToApi(row: Record<string, unknown>) {
  if (!row) return row;
  const full = employeeFullName({
    fn: String(row.fn || ""),
    mn: String(row.mn || ""),
    ln: String(row.ln || "")
  });
  const status = (row.status as EmployeeStatus) || "Active";
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
    addr: row.addr || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
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
    active: isActiveEmployee(status),
    relname: row.relname || "",
    relphone: row.relphone || "",
    docs: row.docs || [],
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

/** Find an active employee that already uses this mobile (last 8 digits match). */
export function findActiveEmployeeDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isActiveEmployee(r.status)
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
export function deactivatePatch(actorEmail: string, reason = "") {
  return {
    status: "Inactive" as EmployeeStatus,
    leave_date: new Date().toISOString().slice(0, 10),
    deactivation_reason: reason || null,
    updated_by: actorEmail
  };
}

/** Patch to (re)activate. */
export function activatePatch(actorEmail: string) {
  return {
    status: "Active" as EmployeeStatus,
    leave_date: null,
    deactivation_reason: null,
    updated_by: actorEmail
  };
}

/** Patch for arbitrary status change (used by /status route). */
export function statusPatch(status: EmployeeStatus, actorEmail: string, reason = "") {
  if (status === "Inactive") return deactivatePatch(actorEmail, reason);
  if (status === "Active") return activatePatch(actorEmail);
  return {
    status,
    deactivation_reason: reason || null,
    updated_by: actorEmail
  };
}
