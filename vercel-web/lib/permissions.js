/** Map hh_users.role labels to permission buckets used by the React shell. */
function normalizeRole(role) {
  var key = String(role || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (key === "ADMIN" || key === "MANAGER" || key === "EXECUTIVE") return "ADMIN";
  if (key === "ACCOUNTANT") return "ACCOUNTANT";
  if (key === "NURSE") return "NURSE";
  if (key === "ATTENDANT") return "ATTENDANT";
  if (key === "STAFF") return "STAFF";
  return key || "STAFF";
}

var rolePermissions = {
  ADMIN: ["*", "audits.read"],
  STAFF: [
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
    "reports.read",
    "audits.read"
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
    "reports.read",
    "audits.read"
  ],
  NURSE: ["dashboard.read", "employees.read", "patients.read", "payouts.read", "attendance.read", "attendance.write"],
  ATTENDANT: ["dashboard.read", "employees.read", "patients.read", "payouts.read", "attendance.read", "attendance.write"]
};

export function hasPermission(role, permission) {
  if (!permission) return true;
  var list = rolePermissions[normalizeRole(role)] || rolePermissions.STAFF || [];
  return list.indexOf("*") >= 0 || list.indexOf(permission) >= 0;
}
