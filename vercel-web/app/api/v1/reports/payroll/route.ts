import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const url = new URL(req.url);
  const query = {
    period: url.searchParams.get("period") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined
  };
  const result = await reportService.payroll(query, { actor });
  return respond(result);
});
