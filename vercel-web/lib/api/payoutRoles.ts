/**
 * Payout-specific RBAC role lists.
 *
 * M2-H1 (2026-05-29): values now live in `src/business/rbac.ts`. This
 * file is a thin shim so existing route handlers continue importing
 * from `@/lib/api/payoutRoles` without churn. Prefer
 * `@/business/rbac` in new code.
 */

export {
  PAYOUT_READ_ROLES,
  PAYOUT_WRITE_ROLES,
  PAYOUT_PAY_ROLES,
  PAYOUT_ADJUST_ROLES,
  PAYOUT_REOPEN_ROLES
} from "@/business/rbac";
