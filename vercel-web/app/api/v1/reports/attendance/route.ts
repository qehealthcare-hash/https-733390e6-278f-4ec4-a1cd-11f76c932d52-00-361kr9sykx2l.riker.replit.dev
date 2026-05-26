import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/attendance?period=YYYY-MM[&from=&to=&employee_id=&status=&limit=&offset=]
 *
 * Per-period attendance summary with per-employee breakdown. The headline
 * `summary.total` comes from Supabase `count='exact'` so it stays accurate
 * even when more than 1 000 rows exist in the window; the per-employee
 * grid is rolled up from a 1 000-row materialisation cap.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REPORT_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined
  };
  const result = await reportService.attendanceSummary(query, { actor });
  return respond(result);
});
