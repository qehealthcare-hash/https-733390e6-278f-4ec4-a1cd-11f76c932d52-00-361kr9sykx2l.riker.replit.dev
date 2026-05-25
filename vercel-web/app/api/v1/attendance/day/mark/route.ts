import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { attendanceService } from "@/services/attendanceService";
import { respond } from "@/lib/api/apiResultBridge";
import { parseJsonBody } from "@/lib/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/attendance/day/mark
 *
 * Body:
 *   {
 *     date: "YYYY-MM-DD",
 *     employee_id: string,
 *     duty_id?: string,
 *     patient_id?: string,
 *     shift_type?: string,
 *     status: AttendanceStatus,
 *     check_in_at?: ISO,
 *     check_out_at?: ISO,
 *     notes?: string,
 *     sync_duty?: boolean   // default true — also flips SCHEDULED→IN_PROGRESS
 *   }
 *
 * Quick-mark surface for the all-staff attendance board. Upserts the
 * attendance row and, when `sync_duty !== false`, advances the associated
 * duty lifecycle so the calendar stays in sync.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Nurse", "Supervisor"]);
  const body = await parseJsonBody(req);
  const result = await attendanceService.dayMark(body, { actor });
  return respond(result);
});
