import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  USER_ADMIN_ROLES,
  USER_DEACTIVATE_ROLES,
  USER_UPDATE_ROLES
} from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { userService } from "@/services/userService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...USER_ADMIN_ROLES]);
  const result = await userService.getUser(params.id, toServiceContext(actor));
  return respond(result);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...USER_UPDATE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await userService.updateUser(params.id, body, toServiceContext(actor));
  return respond(result);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...USER_DEACTIVATE_ROLES]);
  const result = await userService.deactivateUser(params.id, toServiceContext(actor));
  return respond(result);
});
