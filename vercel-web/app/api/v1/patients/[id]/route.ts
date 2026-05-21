import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { patientService, patientSchema } from "@/lib/api/services/patient.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const row = await patientService.getById(params.id);
  return jsonOk(row);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const body = await parseJsonBody(req);
  const input = patientSchema.parse({ ...body, id: params.id });
  const row = await patientService.update(params.id, input, actor);
  return jsonOk(row);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const result = await patientService.remove(params.id, actor);
  return jsonOk(result);
});
