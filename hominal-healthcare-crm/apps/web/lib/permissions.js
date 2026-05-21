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
    "reports.read",
    "doctors.read",
    "doctors.write",
    "vendors.read",
    "vendors.write",
    "catalog.read",
    "settings.read"
  ],
  ACCOUNTANT: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "billings.read",
    "billings.write",
    "payouts.read",
    "payouts.write",
    "reports.read",
    "vendors.read",
    "catalog.read",
    "settings.read"
  ],
  NURSE: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read",
    "catalog.read"
  ],
  ATTENDANT: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read",
    "catalog.read"
  ]
};

function listForRole(role) {
  return rolePermissions[String(role || "").toUpperCase()] || [];
}

/**
 * @param {object|string|null} profileOrRole — prefer full `profile` from `/auth/me` (includes `permissions` from DB).
 * @param {string} permission
 */
export function hasPermission(profileOrRole, permission) {
  if (profileOrRole == null || profileOrRole === "") return false;
  if (typeof profileOrRole === "object") {
    var perms = profileOrRole.permissions;
    if (Array.isArray(perms) && perms.length > 0) {
      return perms.indexOf("*") >= 0 || perms.indexOf(permission) >= 0;
    }
    var list = listForRole(profileOrRole.role);
    return list.indexOf("*") >= 0 || list.indexOf(permission) >= 0;
  }
  var staticList = listForRole(profileOrRole);
  return staticList.indexOf("*") >= 0 || staticList.indexOf(permission) >= 0;
}
