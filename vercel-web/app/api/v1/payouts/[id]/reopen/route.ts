import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_REOPEN_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { payoutRowDtoSchema } from "@/validation/payoutDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...PAYOUT_REOPEN_ROLES]);
  const body = await parseJsonBody(req);
  const result = await payoutService.reopen(params.id, body, { actor });
  return respondValidated(result, payoutRowDtoSchema);
});
