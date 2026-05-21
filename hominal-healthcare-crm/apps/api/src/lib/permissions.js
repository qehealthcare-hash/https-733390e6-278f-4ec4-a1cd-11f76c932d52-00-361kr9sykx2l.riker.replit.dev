export const ROLE_PERMISSIONS = {
  admin: ["*"],
  staff: [
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
  accountant: [
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
  nurse: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read",
    "catalog.read"
  ],
  attendant: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read",
    "catalog.read"
  ]
};

/** Static fallback when DB grants table is empty or unavailable (uppercase role). */
export function getStaticPermissionCodesForRole(role) {
  const normalizedRole = String(role || "").toLowerCase();
  const list = ROLE_PERMISSIONS[normalizedRole] || [];
  return list.slice();
}

export function hasPermission(role, permission) {
  const normalizedRole = String(role || "").toLowerCase();
  const list = ROLE_PERMISSIONS[normalizedRole] || [];
  return list.includes("*") || list.includes(permission);
}

/** Prefer resolved codes from DB (attached on req.auth.permissions). */
export function hasPermissionFromCodes(codes, permission) {
  if (!Array.isArray(codes) || !codes.length) return false;
  return codes.includes("*") || codes.includes(permission);
}
