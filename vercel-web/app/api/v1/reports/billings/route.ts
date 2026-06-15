import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { reportBillingsSummaryResponseDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/billings?period=YYYY-MM[&from=&to=&status=&patient_id=&limit=&offset=]
 *
 * Period billing summary — total billed (svc), received (receipts),
 * outstanding (clamped ≥ 0), plus a paginated `rows` slice of the
 * billings that had period activity. Totals are derived from server-side
 * sums over `hh_svc_entries` + `hh_receipts` so they don't drift with
 * the row slice.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REPORT_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined
  };
  const result = await reportService.billingsSummary(query, { actor });
  return respondValidated(result, reportBillingsSummaryResponseDtoSchema);
});
