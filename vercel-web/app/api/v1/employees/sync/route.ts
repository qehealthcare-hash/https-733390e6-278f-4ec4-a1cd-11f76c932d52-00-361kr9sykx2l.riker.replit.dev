import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { employeeService } from "@/services/employeeService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/employees/sync
 *
 * Legacy SPA upsert — accepts the `toSbEmployee()` column set and routes
 * through `employeeService.syncLegacy` (audited, RLS-scoped).
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: "POST /employees/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await employeeService.syncLegacy(body, { actor });
    return respond(result);
  });
});
