export type NavModule = {
  href: string;
  label: string;
  permission: string | null;
};

export const modules: NavModule[] = [
  { href: "/dashboard", label: "Dashboard", permission: "dashboard.read" },
  { href: "/patients", label: "Patients", permission: "patients.read" },
  { href: "/employees", label: "Employees", permission: "employees.read" },
  { href: "/inquiries", label: "Inquiries", permission: "inquiries.read" },
  { href: "/duties", label: "Duty calendar", permission: "duties.read" },
  { href: "/attendance", label: "Attendance", permission: "attendance.read" },
  { href: "/billings", label: "Billing", permission: "billings.read" },
  { href: "/payouts", label: "Payouts", permission: "payouts.read" },
  { href: "/doctors", label: "Doctors", permission: "doctors.read" },
  { href: "/vendors", label: "Vendors", permission: "vendors.read" },
  { href: "/reports", label: "Reports", permission: "reports.read" },
  { href: "/settings", label: "Settings", permission: "settings.read" },
  { href: "/users", label: "Users & roles", permission: "users.read" },
  { href: "/audits", label: "Audit log", permission: "audits.read" },
  { href: "/legacy", label: "Classic CRM", permission: null }
];
