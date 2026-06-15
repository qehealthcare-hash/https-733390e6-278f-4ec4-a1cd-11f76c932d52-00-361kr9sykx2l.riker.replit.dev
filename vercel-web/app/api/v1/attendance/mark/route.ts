import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ATTENDANCE_WRITE_ROLES } from "@/business/rbac";
import { attendanceService } from "@/services/attendanceService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { attendanceRowDtoSchema } from "@/validation/attendanceDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/attendance/mark
 *
 * Upsert-style endpoint for the "Mark Present / Mark Absent" UI.
 *
 *   body: AttendanceInput (status defaults to PRESENT)
 *
 * If an attendance row already exists for the same `duty_id` (or same
 * employee + calendar date when no duty is set), it's updated in place.
 * Otherwise a new row is created. Either way, payout is recomputed for the
 * row's YYYY-MM period and the persisted row is returned so the frontend
 * can refetch.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...ATTENDANCE_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await attendanceService.mark(body, { actor });
  return respondValidated(result, attendanceRowDtoSchema);
});
