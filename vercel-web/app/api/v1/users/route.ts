import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { USER_ADMIN_ROLES, USER_CREATE_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  userListResponseDtoSchema,
  userRowDtoSchema
} from "@/validation/userDto";
import { userService } from "@/services/userService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...USER_ADMIN_ROLES]);
  const url = new URL(req.url);
  const result = await userService.listUsers(
    {
      q: url.searchParams.get("q") || undefined,
      role: url.searchParams.get("role") || undefined,
      active: url.searchParams.get("active") || undefined,
      limit: Number(url.searchParams.get("limit") || 200),
      offset: Number(url.searchParams.get("offset") || 0)
    },
    toServiceContext(actor)
  );
  return respondValidated(result, userListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...USER_CREATE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await userService.createUser(body, toServiceContext(actor));
  return respondValidated(result, userRowDtoSchema, 201);
});
