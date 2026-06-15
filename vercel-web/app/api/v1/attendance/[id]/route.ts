import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  ATTENDANCE_DELETE_ROLES,
  ATTENDANCE_READ_ROLES,
  ATTENDANCE_WRITE_ROLES
} from "@/business/rbac";
import { attendanceService } from "@/services/attendanceService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  attendanceDeleteResultDtoSchema,
  attendanceRowDtoSchema
} from "@/validation/attendanceDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, [...ATTENDANCE_READ_ROLES]);
  const result = await attendanceService.getById(params.id, { actor });
  return respondValidated(result, attendanceRowDtoSchema);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...ATTENDANCE_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await attendanceService.update(params.id, body, { actor });
  return respondValidated(result, attendanceRowDtoSchema);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (req, { params, actor }) => {
  requireRole(actor, [...ATTENDANCE_DELETE_ROLES]);
  const body = await parseJsonBody(req).catch(() => ({}));
  const result = await attendanceService.remove(params.id, { actor }, body);
  return respondValidated(result, attendanceDeleteResultDtoSchema);
});
