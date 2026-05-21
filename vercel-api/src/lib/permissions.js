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
    "reports.read"
  ],
  accountant: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "billings.read",
    "billings.write",
    "payouts.read",
    "payouts.write",
    "reports.read"
  ],
  nurse: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read"
  ],
  attendant: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "self.read"
  ]
};

export function hasPermission(role, permission) {
  const normalizedRole = String(role || "").toLowerCase();
  const list = ROLE_PERMISSIONS[normalizedRole] || [];
  return list.includes("*") || list.includes(permission);
}
