import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { payoutTotalsReportDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/payout-totals?period=YYYY-MM&employee_id=…
 *
 * Canonical payout totals for the month — gross / net / paid / pending /
 * advance / deduction / bonus. Mirrors the table view + the dashboard.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REPORT_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined
  };
  const result = await reportService.payoutTotals(query, { actor });
  return respondValidated(result, payoutTotalsReportDtoSchema);
});
