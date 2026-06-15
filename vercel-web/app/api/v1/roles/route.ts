import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { ROLE_ADMIN_ROLES, USER_ADMIN_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  roleListResponseDtoSchema,
  roleRowDtoSchema
} from "@/validation/userDto";
import { userService } from "@/services/userService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  requireRole(actor, [...USER_ADMIN_ROLES]);
  const result = await userService.listRoles(toServiceContext(actor));
  return respondValidated(result, roleListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...ROLE_ADMIN_ROLES]);
  const body = await parseJsonBody(req);
  const result = await userService.createRole(body, toServiceContext(actor));
  return respondValidated(result, roleRowDtoSchema, 201);
});
