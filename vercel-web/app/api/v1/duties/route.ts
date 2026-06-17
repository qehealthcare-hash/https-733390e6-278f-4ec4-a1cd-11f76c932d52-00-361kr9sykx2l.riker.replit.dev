import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_READ_ROLES, DUTY_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { dutyService } from "@/services/dutyService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyDetailDtoSchema, dutyListResponseDtoSchema, dutyRowDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, DUTY_READ_ROLES);
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const result = await dutyService.list(query, { actor });
  return respondValidated(result, dutyListResponseDtoSchema, 200, {
    kind: "list",
    list: { rowSchema: dutyRowDtoSchema, scope: "GET /duties", idField: "id" }
  });
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, DUTY_WRITE_ROLES);
  return withIdempotency(req, actor, { route: "POST /duties" }, async () => {
    const body = await parseJsonBody(req);
    const result = await dutyService.create(body, { actor });
    return respondValidated(result, dutyDetailDtoSchema, 201);
  });
});
