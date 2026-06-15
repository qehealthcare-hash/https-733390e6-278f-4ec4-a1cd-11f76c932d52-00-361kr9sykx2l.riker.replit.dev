import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { profitLossReportDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/profit-loss?period=YYYY-MM
 *
 * Revenue (collected receipts) − payouts paid for the window. Also exposes
 * `net_profit_after_pending_payouts` (= revenue − all payouts net) so
 * finance can see the worst-case exposure.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REPORT_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const result = await reportService.profitLoss(query, { actor });
  return respondValidated(result, profitLossReportDtoSchema);
});
