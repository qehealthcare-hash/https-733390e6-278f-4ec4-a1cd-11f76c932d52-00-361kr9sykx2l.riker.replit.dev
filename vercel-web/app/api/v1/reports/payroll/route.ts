import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { reportService } from "@/lib/api/services/report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || undefined;
  const data = await reportService.payroll(month);
  return jsonOk(data);
});
