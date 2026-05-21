import type { EmployeeInput } from "@/validation/employeeValidation";
import { findPhoneDuplicate } from "@/business/phoneRules";

export function employeeFullName(parts: { fn?: string; mn?: string; ln?: string }): string {
  return [parts.fn, parts.mn, parts.ln].filter(Boolean).join(" ").trim();
}

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
    relname: input.relname,
    relphone: input.relphone,
    docs: input.docs ?? undefined
  };
}

export function employeeToApi(row: Record<string, unknown>) {
  if (!row) return row;
  const full = employeeFullName({
    fn: String(row.fn || ""),
    mn: String(row.mn || ""),
    ln: String(row.ln || "")
  });
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
    employee_type: row.emp_type || row.etype || "",
    shift: row.shift || "",
    salary: Number(row.salary || 0),
    status: row.status || "Active",
    relname: row.relname || "",
    relphone: row.relphone || "",
    docs: row.docs || [],
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

export function isActiveEmployee(status: string | undefined | null): boolean {
  return (status || "Active") === "Active";
}

export function findActiveEmployeeDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isActiveEmployee(r.status)
  });
}
