/** Roles that may read payout ledgers and period-scoped pending totals. */
export const PAYOUT_READ_ROLES = [
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Executive",
  "Nurse"
] as const;

/** Roles that may ensure, adjust, lock, pay, or record advances. */
export const PAYOUT_WRITE_ROLES = ["Admin", "Manager", "Accountant"] as const;

/** Final disbursement and advance cash-out (stricter than ensure/lock). */
export const PAYOUT_PAY_ROLES = ["Admin", "Accountant"] as const;
