import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/inquiries?period=YYYY-MM[&from=&to=&status=&source=&assigned_to=&limit=&offset=]
 *
 * Returns the per-period inquiry funnel summary plus a paginated `rows`
 * slice. Aggregates come from Supabase `count='exact'` so they are
 * accurate for the entire window, independent of the row slice.
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
    source: url.searchParams.get("source") ?? undefined,
    assigned_to: url.searchParams.get("assigned_to") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined
  };
  const result = await reportService.inquiriesSummary(query, { actor });
  return respond(result);
});
