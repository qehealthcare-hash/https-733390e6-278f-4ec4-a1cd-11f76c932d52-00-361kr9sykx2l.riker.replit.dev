import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/payouts/totals?period=YYYY-MM
 *
 * Dashboard/report total: sums net_amount + duty_count + hours from all
 * payout rows in the period. Used so the dashboard widget and the payouts
 * table always agree.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return respond({
      success: false,
      error: "period must be YYYY-MM",
      code: ErrorCodes.validation
    });
  }
  const result = await payoutService.monthlyTotal(period, { actor });
  return respond(result);
});
