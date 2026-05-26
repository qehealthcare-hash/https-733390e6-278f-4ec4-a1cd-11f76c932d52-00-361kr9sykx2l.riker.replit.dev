/** Map hh_users.role labels to static permission buckets (fallback when DB perms empty). */
function normalizeRole(role) {
  var key = String(role || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (key === "ADMIN") return "ADMIN";
  if (key === "MANAGER") return "MANAGER";
  if (key === "EXECUTIVE") return "EXECUTIVE";
  if (key === "ACCOUNTANT") return "ACCOUNTANT";
  if (key === "NURSE") return "NURSE";
  if (key === "ATTENDANT") return "ATTENDANT";
  if (key === "VIEWER") return "VIEWER";
  if (key === "SUPERVISOR") return "SUPERVISOR";
  if (key === "STAFF") return "STAFF";
  return key || "STAFF";
}

var rolePermissions = {
  ADMIN: [
    "*",
    "audits.read",
    "users.read",
    "users.write",
    "settings.read",
    "settings.write",
    "doctors.read",
    "doctors.write",
    "vendors.read",
    "vendors.write"
  ],
  MANAGER: [
    "dashboard.read",
    "employees.read",
    "employees.write",
    "patients.read",
    "patients.write",
    "inquiries.read",
    "inquiries.write",
    "billings.read",
    "billings.write",
    "duties.read",
    "duties.write",
    "attendance.read",
    "attendance.write",
    "payouts.read",
    "payouts.write",
    "doctors.read",
    "vendors.read",
    "reports.read",
    "audits.read",
    "settings.read",
    "settings.write",
    "users.read"
  ],
  EXECUTIVE: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "patients.write",
    "inquiries.read",
    "inquiries.write",
    "billings.read",
    "duties.read",
    "duties.write",
    "attendance.read",
    "reports.read"
  ],
  STAFF: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "patients.write",
    "inquiries.read",
    "inquiries.write",
    "billings.read",
    "billings.write",
    "duties.read",
    "duties.write",
    "attendance.read",
    "attendance.write",
    "doctors.read",
    "vendors.read",
    "reports.read"
  ],
  ACCOUNTANT: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "billings.read",
    "billings.write",
    "payouts.read",
    "payouts.write",
    "attendance.read",
    "doctors.read",
    "vendors.read",
    "vendors.write",
    "reports.read",
    "audits.read",
    "settings.read"
  ],
  SUPERVISOR: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "duties.read",
    "duties.write",
    "attendance.read",
    "attendance.write",
    "billings.read"
  ],
  NURSE: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "attendance.read",
    "attendance.write",
    "duties.read",
    "duties.write"
  ],
  ATTENDANT: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "attendance.read",
    "attendance.write"
  ],
  VIEWER: ["dashboard.read", "billings.read", "reports.read"]
};

/**
 * @param {string} role
 * @param {string} permission
 * @param {string[]|null|undefined} dbPermissions from `/auth/me` (`hh_roles.perms`)
 */
export function hasPermission(role, permission, dbPermissions) {
  if (!permission) return true;
  if (dbPermissions && dbPermissions.length) {
    return dbPermissions.indexOf("*") >= 0 || dbPermissions.indexOf(permission) >= 0;
  }
  var list = rolePermissions[normalizeRole(role)] || rolePermissions.STAFF || [];
  return list.indexOf("*") >= 0 || list.indexOf(permission) >= 0;
}
