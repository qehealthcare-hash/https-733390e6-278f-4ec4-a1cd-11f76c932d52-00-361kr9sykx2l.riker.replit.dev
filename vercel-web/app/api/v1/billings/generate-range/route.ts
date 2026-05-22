import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/billings/generate-range
 *
 * Idempotent: bills every uncovered duty in `period` for `patient_id`.
 * Rerunning skips duties that already have a service entry.
 *
 *   body: GenerateFromDutyRangeInput
 *   returns: { billing_id, created, skipped, totals }
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /billings/generate-range" }, async () => {
    const body = await parseJsonBody(req);
    const result = await billingService.generateFromDutyRange(body, { actor });
    return respond(result, 201);
  });
});
