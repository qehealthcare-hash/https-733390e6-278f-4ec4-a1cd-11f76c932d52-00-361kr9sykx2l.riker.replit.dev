import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { attendanceService, attendanceSchema } from "@/lib/api/services/attendance.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const data = await attendanceService.getById(params.id);
  return jsonOk(data);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  const body = await parseJsonBody(req);
  const input = attendanceSchema.parse({ ...body, id: params.id });
  const data = await attendanceService.update(params.id, input, actor);
  return jsonOk(data);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const data = await attendanceService.remove(params.id, actor);
  return jsonOk(data);
});
