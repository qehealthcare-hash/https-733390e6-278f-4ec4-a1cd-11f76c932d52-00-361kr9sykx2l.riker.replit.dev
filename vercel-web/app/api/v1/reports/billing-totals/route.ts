import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/billing-totals?period=YYYY-MM
 *
 * Canonical billing-side totals for the dashboard widget and the records
 * page. Both should call this so they can never drift.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined
  };
  const result = await reportService.billingTotals(query, { actor });
  return respond(result);
});
