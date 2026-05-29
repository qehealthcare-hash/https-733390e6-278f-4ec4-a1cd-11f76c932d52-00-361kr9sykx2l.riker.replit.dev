import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { EMPLOYEE_SYNC_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { employeeService } from "@/services/employeeService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/employees/sync
 *
 * **Legacy quarantine (M6-G):** still required by `public/lib/legacy-api.js`
 * (`HominalApi.employees.sync` → `toSbEmployee()` upserts). Do not remove
 * until the legacy SPA is retired. The modern page uses `POST /employees`
 * and `PUT /employees/:id` instead. Access: `EMPLOYEE_SYNC_ROLES`.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, EMPLOYEE_SYNC_ROLES);
  return withIdempotency(req, actor, { route: "POST /employees/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await employeeService.syncLegacy(body, { actor });
    return respond(result);
  });
});
