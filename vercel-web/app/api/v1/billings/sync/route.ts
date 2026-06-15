import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { billingRowDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/billings/sync
 *
 * Legacy SPA upsert — accepts the `toSbBilling()` column set and routes
 * through `billingService.syncLegacy` (audited, RLS-scoped).
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  return withIdempotency(req, actor, { route: "POST /billings/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await billingService.syncLegacy(body, { actor });
    return respondValidated(result, billingRowDtoSchema);
  });
});
