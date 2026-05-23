import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { doctorService } from "@/lib/api/services/doctor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  const data = await doctorService.get(params.id, actor.accessToken);
  return jsonOk(data);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const data = await doctorService.update(params.id, body, actor.accessToken);
  return jsonOk(data);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const data = await doctorService.remove(params.id, actor.accessToken);
  return jsonOk(data);
});
