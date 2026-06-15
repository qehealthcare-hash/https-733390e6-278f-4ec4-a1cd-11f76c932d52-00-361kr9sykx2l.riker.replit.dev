import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ATTENDANCE_READ_ROLES } from "@/business/rbac";
import { attendanceService } from "@/services/attendanceService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { attendanceRangeBoardDtoSchema } from "@/validation/attendanceDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns one row per (calendar-day × duty × partner) for the window,
 * merging duty diary + recorded attendance. Used by the Attendance log
 * and the salary-reference PDF so supervisors see every worked /
 * scheduled day even before attendance is explicitly marked.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...ATTENDANCE_READ_ROLES]);
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const employee_id = url.searchParams.get("employee_id") || undefined;
  const patient_id = url.searchParams.get("patient_id") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const result = await attendanceService.rangeBoard(
    from,
    to,
    { employee_id, patient_id, status },
    { actor }
  );
  return respondValidated(result, attendanceRangeBoardDtoSchema);
});
