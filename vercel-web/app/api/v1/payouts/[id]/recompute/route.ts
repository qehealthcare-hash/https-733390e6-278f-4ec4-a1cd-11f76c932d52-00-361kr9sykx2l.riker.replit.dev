import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payouts/:id/recompute
 *
 * Re-runs `hh_recompute_payout` against the payout's existing
 * (employee_id, period_month) pair — useful after a duty or attendance
 * correction made outside the service layer.
 */
export const POST = withAuth<{ id: string }>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const detail = await payoutService.getById(params.id, { actor });
  if (!detail.success) return respond(detail);
  const payout = detail.data!.payout;
  const result = await payoutService.recompute(
    { employee_id: payout.employee_id, period_month: payout.period_month },
    { actor }
  );
  return respond(result);
});
