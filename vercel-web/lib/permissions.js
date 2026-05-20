var rolePermissions = {
  ADMIN: ["*"],
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
    "reports.read"
  ],
  NURSE: ["dashboard.read", "employees.read", "patients.read", "payouts.read"],
  ATTENDANT: ["dashboard.read", "employees.read", "patients.read", "payouts.read"]
};

export function hasPermission(role, permission) {
  var list = rolePermissions[String(role || "").toUpperCase()] || [];
  return list.indexOf("*") >= 0 || list.indexOf(permission) >= 0;
}
