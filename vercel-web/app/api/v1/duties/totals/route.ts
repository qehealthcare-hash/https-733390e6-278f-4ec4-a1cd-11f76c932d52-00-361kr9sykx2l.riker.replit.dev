import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_TOTALS_ROLES } from "@/business/rbac";
import { dutyService } from "@/services/dutyService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyTotalsResponseDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, DUTY_TOTALS_ROLES);
  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id") || undefined;
  const employeeId = url.searchParams.get("employee_id") || undefined;
  const period = url.searchParams.get("period") || undefined;
  const result = await dutyService.totalsFor(patientId, employeeId, { actor }, { period });
  return respondValidated(result, dutyTotalsResponseDtoSchema);
});
