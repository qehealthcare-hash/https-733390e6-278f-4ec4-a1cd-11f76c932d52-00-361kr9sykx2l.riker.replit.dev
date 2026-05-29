import { withAuth } from "@/lib/api/handler";
import { respond } from "@/lib/api/apiResultBridge";
import { success } from "@/utils/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the actor envelope used by the React shell to gate UI.
 *
 * `permissions` stays in the response (as an empty array) for backward
 * compatibility with any in-flight client that still reads it; the
 * field is no longer populated server-side because Module 2 (RBAC)
 * confirmed the CRM is role-based and the DB perm matrix is unused.
 * Frontend's `hasPermission(role, permission)` consults the static
 * role→permission map in `lib/permissions.js`.
 */
export const GET = withAuth(async (_req, { actor }) => {
  return respond(
    success({
      id: actor.userId,
      email: actor.email,
      username: actor.username,
      role: actor.role,
      permissions: [] as string[]
    })
  );
});
