/**
 * Frontend permission gate.
 *
 * M2-H1 (2026-05-29): logic now lives in `src/business/rbac.ts`. This
 * file is a thin compatibility shim so `auth-guard.js`, `sidebar.js`
 * and `payouts/payouts-inner.js` keep their existing
 * `@/lib/permissions` import unchanged. Prefer importing
 * `hasCapability` from `@/business/rbac` in new code.
 *
 * Module 2 audit (Appendix C of `audit-rubric.md`) explains why the
 * legacy `dbPermissions` third argument was removed: `hh_roles.perms`
 * stores nested objects that the parser could never flatten, so the
 * value was always an empty array.
 */

import { hasCapability } from "@/business/rbac";

export function hasPermission(role: unknown, permission: string | null | undefined): boolean {
  return hasCapability(role, permission);
}
