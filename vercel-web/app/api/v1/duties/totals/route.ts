import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive", "Nurse"]);
  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id") || undefined;
  const employeeId = url.searchParams.get("employee_id") || undefined;
  const period = url.searchParams.get("period") || undefined;
  const result = await dutyService.totalsFor(patientId, employeeId, { actor }, { period });
  return respond(result);
});
