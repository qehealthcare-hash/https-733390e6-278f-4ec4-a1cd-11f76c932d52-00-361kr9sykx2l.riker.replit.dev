/**
 * Billing-specific RBAC role lists.
 *
 * M2-H1 (2026-05-29): values now live in `src/business/rbac.ts`. This
 * file is a thin shim so existing route handlers continue importing
 * from `@/lib/api/billingRoles` without churn. Prefer
 * `@/business/rbac` in new code.
 */

export { BILLING_READ_ROLES, BILLING_WRITE_ROLES, BILLING_RECEIVE_ROLES } from "@/business/rbac";
