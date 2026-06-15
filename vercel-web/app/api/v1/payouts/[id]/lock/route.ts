import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_WRITE_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { parseInput } from "@/validation/parseValidation";
import { payoutLockSchema } from "@/validation/payoutValidation";
import { payoutRowDtoSchema } from "@/validation/payoutDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...PAYOUT_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const parsed = parseInput(payoutLockSchema, body);
  if (!parsed.success) return respond(parsed);
  const result = await payoutService.lock(params.id, parsed.data, { actor });
  return respondValidated(result, payoutRowDtoSchema);
});
