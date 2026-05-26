/**
 * POST /api/v1/payouts/[id]/pay-advance
 *
 * Records an ADVANCE disbursement against an OPEN payout — partial cash
 * out before the period is locked. Mirrors `/payouts/pay` for proof and
 * serial handling but keeps the payout in OPEN status so the accountant
 * can continue compiling charges.
 *
 * RBAC: Admin / Accountant only (same tier as final pay).
 */

import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";
import { parseInput } from "@/validation/parseValidation";
import { payoutAdvanceSchema } from "@/validation/payoutValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(
  async (req: NextRequest, { params, actor }) => {
    requireRole(actor, ["Admin", "Accountant"]);
    return withIdempotency(
      req,
      actor,
      { route: `POST /payouts/${params.id}/pay-advance` },
      async () => {
        const body = await parseJsonBody(req);
        const parsed = parseInput(payoutAdvanceSchema, {
          ...(body as Record<string, unknown>),
          payout_id: params.id
        });
        if (!parsed.success) return respond(parsed);
        const result = await payoutService.payAdvance(parsed.data, { actor });
        return respond(result);
      }
    );
  }
);
