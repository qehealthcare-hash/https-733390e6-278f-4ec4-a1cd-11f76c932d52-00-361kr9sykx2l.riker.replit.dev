import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { EMPLOYEE_READ_ROLES, EMPLOYEE_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { employeeService } from "@/services/employeeService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { employeeDetailDtoSchema, employeeListResponseDtoSchema } from "@/validation/employeeDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, EMPLOYEE_READ_ROLES);
  const url = new URL(req.url);
  const opts = {
    ...pageParams(req),
    status: url.searchParams.get("status") || undefined,
    dept: url.searchParams.get("dept") || undefined
  };
  const result = await employeeService.list(opts, { actor });
  return respondValidated(result, employeeListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, EMPLOYEE_WRITE_ROLES);
  return withIdempotency(req, actor, { route: "POST /employees" }, async () => {
    const body = await parseJsonBody(req);
    const result = await employeeService.create(body, { actor });
    return respondValidated(result, employeeDetailDtoSchema, 201);
  });
});
