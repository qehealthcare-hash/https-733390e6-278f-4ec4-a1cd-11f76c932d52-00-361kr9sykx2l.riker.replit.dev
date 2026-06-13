/**
 * Canonical role & capability matrix for the CRM. (M2-H1)
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 *   1. The set of role NAMES the system recognises (`Role`, `CANONICAL_ROLES`).
 *   2. The role → capability map consulted by the frontend gate
 *      (`hasCapability`, `ROLE_CAPABILITIES`).
 *   3. The server-side role lists handed to `requireRole(actor, [...])`
 *      from `app/api/v1/**` route handlers (REGISTRY_READ_ROLES, etc.).
 *
 * Historically these three concerns lived in three separate files
 * (`lib/permissions.js`, `lib/api/crmRoles.ts`, `lib/api/payoutRoles.ts`)
 * with no shared types or drift guard. Module 2 audit (Appendix C of
 * `audit-rubric.md`) identified at least one concrete drift bug
 * (Supervisor could read `/inquiries` via API but couldn't see the
 * sidebar entry). This relocation is purely structural — the string
 * values match the prior files exactly so no live behaviour changes —
 * but a new TypeScript `Role` union now binds every list together, and
 * a drift-guard test (`src/integration/__tests__/rbac.drift.test.ts`)
 * enforces that every `requireRole(actor, [...])` literal in route
 * handlers references a string in `CANONICAL_ROLES`.
 *
 * Architecture constraints:
 *   - Lives in `src/business/*` so BOTH server (`app/api/*`, `lib/api/*`)
 *     and frontend (`components/*`, `app/*` pages) can import it.
 *   - Pure module: no Supabase, no Next.js, no repos. Per
 *     `src/integration/__tests__/architecture.boundaries.test.ts`.
 *
 * Adding a new role? Steps:
 *   1. Add the label here AND insert the row into `hh_roles` via a
 *      migration (mirror `20260529110000_reconcile_role_names.sql`).
 *   2. Add the role's capability list to `ROLE_CAPABILITIES`.
 *   3. Decide which server lists (REGISTRY_READ_ROLES etc.) it belongs
 *      to. TypeScript will fail to compile until each list is updated.
 *   4. Add coverage in `src/integration/__tests__/rbacMatrix.route.test.ts`.
 */

export const CANONICAL_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Accountant",
  "Executive",
  "Nurse",
  "Supervisor"
] as const;

export type Role = (typeof CANONICAL_ROLES)[number];

/* ------------------------------------------------------------------------- *
 * Role normalisation (frontend-friendly, accepts arbitrary input).
 * ------------------------------------------------------------------------- */

const CANONICAL_LOOKUP: Record<string, Role> = CANONICAL_ROLES.reduce(
  (acc, role) => {
    acc[role.toUpperCase()] = role;
    return acc;
  },
  {} as Record<string, Role>
);

/**
 * Is `input` exactly one of the canonical role labels? Returns a
 * type-guard for downstream narrowing.
 */
export function isCanonicalRole(input: unknown): input is Role {
  return typeof input === "string" && (CANONICAL_ROLES as readonly string[]).includes(input);
}

/**
 * Coerce arbitrary role input (possibly typoed, lowercased, hyphenated)
 * to a canonical `Role`. Falls back to `"Staff"` — the most restrictive
 * "knows their way around the CRM" bucket — so a typo never silently
 * grants elevated access.
 */
export function normalizeRole(input: unknown): Role {
  if (input == null) return "Staff";
  const raw = String(input).trim();
  if (raw.length === 0) return "Staff";
  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return CANONICAL_LOOKUP[key] ?? "Staff";
}

/* ------------------------------------------------------------------------- *
 * Capability map (frontend gate).
 *
 * `*` is a wildcard granting every capability. Lists are intentionally
 * verbose rather than computed because (a) the audit log of "who could
 * see what when" is easier to read, and (b) tools like grep can find
 * every site that grants `billings.write`.
 *
 * NOTE: The string values below match the legacy `lib/permissions.js`
 * map verbatim (Module 2 commit — relocation only). Any semantic change
 * (e.g. Supervisor billings vs inquiries reconciliation) MUST go through
 * a separate fix marked with its own audit ID.
 * ------------------------------------------------------------------------- */

export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly string[]>> = {
  Admin: [
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
  Manager: [
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
  Executive: [
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
  Staff: [
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
    "doctors.read",
    "vendors.read",
    "reports.read"
  ],
  Accountant: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "billings.read",
    "billings.write",
    "payouts.read",
    "attendance.read",
    "doctors.read",
    "vendors.read",
    "vendors.write",
    "reports.read",
    "audits.read",
    "settings.read"
  ],
  Supervisor: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "duties.read",
    "duties.write",
    "attendance.read",
    "billings.read"
  ],
  Nurse: [
    "dashboard.read",
    "employees.read",
    "patients.read",
    "payouts.read",
    "attendance.read",
    "duties.read",
    "duties.write"
  ]
};

/**
 * Return `true` if `role` is allowed to perform `capability`. Treats
 * a falsy `capability` as "no restriction" (so callers can pass a
 * possibly-undefined permission string from navigation metadata).
 */
export function hasCapability(role: unknown, capability: string | null | undefined): boolean {
  if (!capability) return true;
  const list = ROLE_CAPABILITIES[normalizeRole(role)] ?? ROLE_CAPABILITIES.Staff;
  return list.includes("*") || list.includes(capability);
}

/* ------------------------------------------------------------------------- *
 * Server-side role lists (consumed by `requireRole(actor, [...])`).
 *
 * Typed as `readonly Role[]` so TypeScript catches any drift between
 * these arrays and the canonical role catalogue. The drift-guard test
 * (`rbac.drift.test.ts`) enforces the same constraint for INLINE
 * arrays of role strings inside route files.
 *
 * Values match `lib/api/crmRoles.ts` and `lib/api/payoutRoles.ts`
 * verbatim — Module 2 commit is relocation only.
 * ------------------------------------------------------------------------- */

/** Patients, employees, inquiries, duties, attendance registry reads. */
export const REGISTRY_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor",
  "Nurse"
];

/** Doctors, vendors, lookups. */
export const DIRECTORY_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor"
];

/**
 * Financial report APIs (`/reports/*` summaries, totals, payroll).
 * Matches `reports.read` for finance roles and Executive oversight.
 * Staff has `reports.read` in navigation metadata but is excluded here
 * intentionally — field roles use module-specific screens instead.
 */
export const REPORT_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Accountant",
  "Executive"
];

export const AUDIT_READ_ROLES: readonly Role[] = ["Admin", "Manager", "Accountant"];

export const USER_ADMIN_ROLES: readonly Role[] = ["Admin", "Manager"];

export const SETTINGS_READ_ROLES: readonly Role[] = ["Admin", "Manager", "Accountant"];

/** Create/update settings keys (`POST /settings`, `PUT /settings/:key`). */
export const SETTINGS_WRITE_ROLES: readonly Role[] = USER_ADMIN_ROLES;

/** Delete settings keys (`DELETE /settings/:key`). */
export const SETTINGS_DELETE_ROLES: readonly Role[] = ["Admin"];

/** Create CRM users (`POST /users`). */
export const USER_CREATE_ROLES: readonly Role[] = ["Admin"];

/** Update CRM users (`PATCH /users/:id`). */
export const USER_UPDATE_ROLES: readonly Role[] = ["Admin"];

/** Deactivate users (`DELETE /users/:id`). */
export const USER_DEACTIVATE_ROLES: readonly Role[] = ["Admin"];

/** Role catalogue CRUD (`/roles/*`). */
export const ROLE_ADMIN_ROLES: readonly Role[] = ["Admin"];

export const WHATSAPP_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Accountant"
];

export const UPLOAD_WRITE_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Nurse"
];

export const DASHBOARD_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Accountant",
  "Supervisor",
  "Nurse"
];

/* ------------------------ Billing role lists ------------------------------ */

/**
 * Roles allowed to read billing data (lists, bundles, invoices, receipts).
 *
 * M2-H1 drift fix: previously included `"Viewer"` — a role that has
 * NEVER existed in the `hh_roles` catalogue. It was a dead string
 * inherited from an earlier draft. TypeScript caught this when the
 * legacy `AppRole = ... | string` escape hatch was removed; entry
 * deleted because no user can ever match it.
 *
 * Supervisor stays in this list (matches the pre-refactor behaviour).
 * Reconciling Supervisor's read/write posture across the billing
 * module is tracked separately as M2-H3 and will be addressed in
 * Module 10 (Billing) when the wider billings surface is audited.
 */
export const BILLING_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Supervisor"
];

/** Roles allowed to create/update bills, invoices, and close/reopen. */
export const BILLING_WRITE_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Accountant"
];

/**
 * Roles allowed to record payment receipts against calculated outstanding.
 * Billing operators (Accountant) may receive payments but must not edit
 * duty-derived service rows — those are owned by the Duty Calendar.
 */
export const BILLING_RECEIVE_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Accountant"
];

/* ------------------------ Inquiry role lists ------------------------------ */

/**
 * Roles allowed to read inquiries (list, single, status timeline).
 *
 * M4-H2 extracted the constant; **M4-H1 tightens it.** Previously
 * aliased to `REGISTRY_READ_ROLES`, which let `Accountant`,
 * `Supervisor`, and `Nurse` hit the inquiry GET endpoints via
 * a direct URL even though `ROLE_CAPABILITIES` did NOT grant them
 * `inquiries.read` (the sidebar hid the link for those roles).
 *
 * The Module 4 policy decision (option "A — tighten the server to
 * match the frontend") narrows this to the four roles that actually
 * own the lead funnel: Admin, Manager, Executive, Staff. The drift
 * between sidebar capability and server policy is now closed.
 *
 * If a future product call wants Accountant cross-checking inquiry →
 * patient → billing, add `Accountant` here AND add `inquiries.read`
 * to the Accountant entry in `ROLE_CAPABILITIES` so both layers
 * stay in lockstep.
 */
export const INQUIRY_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Executive",
  "Staff"
];

/**
 * Roles allowed to create/update an inquiry or change its status, plus
 * trigger the convert-to-patient flow.
 *
 * Mirrors `["Admin","Manager","Staff","Executive"]` previously hardcoded
 * in 4 separate route handlers (M4-H2). `Accountant` and `Nurse` are
 * intentionally excluded — they read inquiries but do not own them.
 */
export const INQUIRY_WRITE_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive"
];

/**
 * Roles allowed to delete an inquiry (soft-close by default). Hard
 * delete (`?hard=1`) is enforced separately as Admin-only in the route
 * handler so a single constant remains the source of truth for the
 * baseline delete permission.
 */
export const INQUIRY_DELETE_ROLES: readonly Role[] = ["Admin", "Manager"];

/**
 * Roles allowed to call the legacy SPA upsert endpoint
 * (`POST /api/v1/inquiries/sync`). Kept narrow — Admin/Manager only —
 * because the endpoint accepts a wider field set than the modern
 * create/update flow.
 */
export const INQUIRY_SYNC_ROLES: readonly Role[] = ["Admin", "Manager"];

/* ------------------------ Patient role lists ------------------------------ */

/**
 * Roles allowed to read the patient registry (list, detail, lookups).
 * Matches `patients.read` in `ROLE_CAPABILITIES` — intentionally the
 * same cohort as `REGISTRY_READ_ROLES` (Accountant, Supervisor, Nurse
 * may view patients for billing / duty context).
 */
export const PATIENT_READ_ROLES: readonly Role[] = REGISTRY_READ_ROLES;

/** Create/update demographics and assign caretaker via PATCH or /assign. */
export const PATIENT_WRITE_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive"
];

/**
 * Soft-close (`DELETE` without `?hard`) and reopen (`POST …/reopen`).
 * Narrower than write — cascade closes billings/duties.
 */
export const PATIENT_CLOSE_ROLES: readonly Role[] = ["Admin", "Manager"];

export const PATIENT_REOPEN_ROLES: readonly Role[] = PATIENT_CLOSE_ROLES;

/**
 * Patient ledger bundle (billings, duties, receipts, audits).
 * Nurse may view history; Accountant/Supervisor may read the registry
 * but not the full financial ledger.
 */
export const PATIENT_HISTORY_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Nurse"
];

/**
 * Legacy SPA upsert (`POST /patients/sync`). Required by
 * `public/lib/legacy-api.js` until the legacy CRM is retired.
 */
export const PATIENT_SYNC_ROLES: readonly Role[] = ["Admin", "Manager"];

/* ------------------------ Employee role lists ----------------------------- */

/** Registry read — matches `employees.read` in `ROLE_CAPABILITIES`. */
export const EMPLOYEE_READ_ROLES: readonly Role[] = REGISTRY_READ_ROLES;

/** Create/update employee demographics (Admin/Manager only). */
export const EMPLOYEE_WRITE_ROLES: readonly Role[] = ["Admin", "Manager"];

/** POST /employees/:id/status and legacy activate/deactivate flows. */
export const EMPLOYEE_STATUS_ROLES: readonly Role[] = EMPLOYEE_WRITE_ROLES;

/** DELETE /employees/:id (soft or hard). */
export const EMPLOYEE_DELETE_ROLES: readonly Role[] = ["Admin"];

/**
 * GET /employees/:id/links — duty/attendance/payout link counts.
 * Accountant may view links for payroll reconciliation; field roles read-only.
 */
export const EMPLOYEE_LINKS_ROLES: readonly Role[] = ["Admin", "Manager", "Accountant"];

/**
 * Legacy SPA upsert (`POST /employees/sync`). Required by `legacy-api.js`.
 */
export const EMPLOYEE_SYNC_ROLES: readonly Role[] = ["Admin", "Manager"];

/* ------------------------ Duty role lists --------------------------------- */

/**
 * List/read duties, diary entries, and totals. Matches `duties.read` in
 * `ROLE_CAPABILITIES` — includes Supervisor (field oversight) but not
 * Accountant.
 */
export const DUTY_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Nurse",
  "Supervisor"
];

/** Create/update duty assignments and materialize diary rows. */
export const DUTY_WRITE_ROLES: readonly Role[] = ["Admin", "Manager", "Staff"];

/** Cancel duty or soft-delete via DELETE without `?hard`. */
export const DUTY_CANCEL_ROLES: readonly Role[] = ["Admin", "Manager"];

/** Permanent duty + diary removal (`DELETE ?hard=1`). */
export const DUTY_DELETE_ROLES: readonly Role[] = ["Admin"];

/** Check-in / check-out attendance markers. */
export const DUTY_CHECK_IN_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Nurse"
];

/** Per-day diary slot PATCH/DELETE. */
export const DUTY_DIARY_WRITE_ROLES: readonly Role[] = DUTY_WRITE_ROLES;

/** Batched diary read (`POST /duties/diary/batch`). */
export const DUTY_DIARY_BATCH_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Nurse"
];

export const DUTY_MATERIALIZE_ROLES: readonly Role[] = DUTY_WRITE_ROLES;
export const DUTY_PARTNERS_ROLES: readonly Role[] = DUTY_WRITE_ROLES;
export const DUTY_TOTALS_ROLES: readonly Role[] = DUTY_READ_ROLES;

/**
 * Daily catch-up materialization (`POST /duties/extend-active`). Admin/Manager
 * only — see route comment (P1-16 duplicate-row guard).
 */
export const DUTY_EXTEND_ROLES: readonly Role[] = ["Admin", "Manager"];

/* --------------------- Attendance role lists ------------------------------ */

/**
 * Operational attendance board + log reads. Matches `attendance.read` in
 * `ROLE_CAPABILITIES` for field roles and Executive oversight. Accountant
 * uses `GET /reports/attendance` (payroll rollup) instead of these routes.
 */
export const ATTENDANCE_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Staff",
  "Executive",
  "Nurse",
  "Supervisor"
];

/** Mark present/absent — Duty Calendar is the operational source; API writes Admin-only break-glass. */
export const ATTENDANCE_WRITE_ROLES: readonly Role[] = ["Admin"];

/** Permanent row removal (`DELETE /attendance/:id`). */
export const ATTENDANCE_DELETE_ROLES: readonly Role[] = ["Admin", "Manager"];

/* ----------------------- Payout-specific role lists ----------------------- */

/** Roles that may read payout ledgers and period-scoped pending totals. */
export const PAYOUT_READ_ROLES: readonly Role[] = [
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Executive",
  "Nurse"
];

/** Roles that may ensure, recompute, lock, or set rates (not disburse). */
export const PAYOUT_WRITE_ROLES: readonly Role[] = ["Admin", "Manager"];

/** Final disbursement, advance cash-out, and ledger adjustments. */
export const PAYOUT_PAY_ROLES: readonly Role[] = ["Admin", "Accountant"];

/** Alias — adjust uses the same tier as pay. */
export const PAYOUT_ADJUST_ROLES: readonly Role[] = PAYOUT_PAY_ROLES;

/** Reopen a locked payout (`POST /payouts/:id/reopen`). Admin only. */
export const PAYOUT_REOPEN_ROLES: readonly Role[] = ["Admin"];
