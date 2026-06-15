import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_READ_ROLES } from "@/lib/api/payoutRoles";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/payouts/totals?period=YYYY-MM
 *
 * Delegates to Reports → Payout totals so dashboard widgets match the report.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_READ_ROLES]);
  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return respond({
      success: false,
      error: "period must be YYYY-MM",
      code: ErrorCodes.validation
    });
  }
  const result = await reportService.payoutTotals({ period }, { actor });
  return respond(result);
});
