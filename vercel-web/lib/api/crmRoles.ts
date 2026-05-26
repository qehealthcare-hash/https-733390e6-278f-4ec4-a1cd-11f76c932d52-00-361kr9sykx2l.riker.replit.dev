/**
 * Shared server-side RBAC role lists for CRM API routes.
 * Keep aligned with `hh_roles.perms` where possible; these are the baseline
 * when the database matrix is empty.
 */

/** Patients, employees, inquiries, duties, attendance registry reads. */
export const REGISTRY_READ_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor",
  "Nurse"
] as const;

/** Doctors, vendors, lookups. */
export const DIRECTORY_READ_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor"
] as const;

export const REPORT_READ_ROLES = ["Admin", "Manager", "Accountant"] as const;

export const AUDIT_READ_ROLES = ["Admin", "Manager", "Accountant"] as const;

export const SETTINGS_READ_ROLES = ["Admin", "Manager", "Accountant"] as const;

export const USER_ADMIN_ROLES = ["Admin", "Manager"] as const;

export const WHATSAPP_READ_ROLES = ["Admin", "Manager", "Staff", "Accountant"] as const;

export const UPLOAD_WRITE_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Nurse"
] as const;

export const DASHBOARD_READ_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor",
  "Nurse"
] as const;
