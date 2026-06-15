import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_READ_ROLES, PAYOUT_WRITE_ROLES } from "@/lib/api/payoutRoles";
import { withIdempotency } from "@/lib/api/idempotency";
import { payoutService } from "@/services/payoutService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  payoutListResponseDtoSchema,
  payoutRowDtoSchema
} from "@/validation/payoutDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_READ_ROLES]);
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined
  };
  const result = await payoutService.list(query, { actor });
  return respondValidated(result, payoutListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_WRITE_ROLES]);
  return withIdempotency(req, actor, { route: "POST /payouts" }, async () => {
    const body = await parseJsonBody(req);
    const result = await payoutService.ensure(body, { actor });
    return respondValidated(result, payoutRowDtoSchema, 201);
  });
});
