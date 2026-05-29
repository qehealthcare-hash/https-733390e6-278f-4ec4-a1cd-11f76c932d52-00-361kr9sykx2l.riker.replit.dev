import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ATTENDANCE_READ_ROLES } from "@/business/rbac";
import { attendanceService } from "@/services/attendanceService";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes, type ApiResult } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/attendance/missing?employee_id=&from=&to=
 *
 * Returns the duties that have no attendance row yet — drives the dashboard
 * "missing attendance" widget. Frontend should call this on every refresh.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...ATTENDANCE_READ_ROLES]);
  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employee_id") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!employeeId || !from || !to) {
    const result: ApiResult<never> = {
      success: false,
      error: "employee_id, from, to are required",
      code: ErrorCodes.badRequest
    };
    return respond(result);
  }
  const result = await attendanceService.listMissingForEmployee(employeeId, from, to, {
    actor
  });
  return respond(result);
});
