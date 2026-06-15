import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ROLE_ADMIN_ROLES, USER_ADMIN_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  roleDeleteResultDtoSchema,
  roleRowDtoSchema
} from "@/validation/userDto";
import { userService } from "@/services/userService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...USER_ADMIN_ROLES]);
  const result = await userService.getRole(params.id, toServiceContext(actor));
  return respondValidated(result, roleRowDtoSchema);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...ROLE_ADMIN_ROLES]);
  const body = await parseJsonBody(req);
  const result = await userService.updateRole(params.id, body, toServiceContext(actor));
  return respondValidated(result, roleRowDtoSchema);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...ROLE_ADMIN_ROLES]);
  const result = await userService.deleteRole(params.id, toServiceContext(actor));
  return respondValidated(result, roleDeleteResultDtoSchema);
});
