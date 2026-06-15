import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { reportPatientsSummaryResponseDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/patients?period=YYYY-MM[&from=&to=&status=&area=&limit=&offset=]
 *
 * Patient registry summary scoped to a period (defaults to the current
 * UTC month). Counts come from Supabase `count='exact'`; `rows` is a
 * paginated slice (default 50, capped at 1000).
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
    area: url.searchParams.get("area") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined
  };
  const result = await reportService.patientsSummary(query, { actor });
  return respondValidated(result, reportPatientsSummaryResponseDtoSchema);
});
