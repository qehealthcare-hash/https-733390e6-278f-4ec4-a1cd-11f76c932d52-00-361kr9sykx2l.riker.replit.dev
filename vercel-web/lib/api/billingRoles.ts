/** Roles allowed to read billing data (lists, bundles, invoices, receipts). */
export const BILLING_READ_ROLES = [
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Supervisor",
  "Viewer"
] as const;

/** Roles allowed to create/update bills, invoices, and receipts. */
export const BILLING_WRITE_ROLES = ["Admin", "Manager", "Accountant", "Staff"] as const;
