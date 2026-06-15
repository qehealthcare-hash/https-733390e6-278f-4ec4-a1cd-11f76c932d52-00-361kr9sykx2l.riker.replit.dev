import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DASHBOARD_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dashboardReportDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...DASHBOARD_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined
  };
  const result = await reportService.dashboard(query, { actor });
  return respondValidated(result, dashboardReportDtoSchema);
});
