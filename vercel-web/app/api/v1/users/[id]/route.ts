import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { userService } from "@/lib/api/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const data = await userService.getUser(params.id);
  return jsonOk(data);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const body = await parseJsonBody(req);
  const data = await userService.updateUser(params.id, body);
  return jsonOk(data);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const data = await userService.deleteUser(params.id);
  return jsonOk(data);
});
