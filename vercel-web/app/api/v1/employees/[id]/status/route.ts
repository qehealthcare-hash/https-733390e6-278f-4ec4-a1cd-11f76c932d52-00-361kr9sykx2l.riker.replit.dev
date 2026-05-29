import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { EMPLOYEE_STATUS_ROLES } from "@/business/rbac";
import { employeeService } from "@/services/employeeService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Explicit activate / deactivate / set-status endpoint. */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, EMPLOYEE_STATUS_ROLES);
  const body = await parseJsonBody(req);
  const result = await employeeService.setStatus(params.id, body, { actor });
  return respond(result);
});

export const PATCH = POST;
