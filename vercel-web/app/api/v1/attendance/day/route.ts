import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ATTENDANCE_READ_ROLES } from "@/business/rbac";
import { attendanceService } from "@/services/attendanceService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/attendance/day?date=YYYY-MM-DD&employee_id=&patient_id=
 *
 * All-staff attendance board for one calendar day. Joins the duty calendar
 * (any duty whose window touches `date`, including open-ended duties),
 * per-day diary reassignments (extra partners), and existing attendance
 * rows into a single payload designed for the operator screen.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...ATTENDANCE_READ_ROLES]);
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const employee_id = url.searchParams.get("employee_id") || undefined;
  const patient_id = url.searchParams.get("patient_id") || undefined;
  const result = await attendanceService.dayBoard(
    date,
    { employee_id, patient_id },
    { actor }
  );
  return respond(result);
});
