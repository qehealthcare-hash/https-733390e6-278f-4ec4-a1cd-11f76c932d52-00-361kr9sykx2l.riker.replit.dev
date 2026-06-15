import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_WRITE_ROLES } from "@/lib/api/payoutRoles";
import { withIdempotency } from "@/lib/api/idempotency";
import { payoutService } from "@/services/payoutService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { ledgerReplaceResultDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payouts/charges/replace
 *
 * Atomically replaces the entire `hh_payout_charges` slice for one
 * `svc_key`. Audited. Body shape: `{ svc_key, rows: [...] }`.
 *
 * M9-G: consumed by `public/lib/legacy-api.js` (`payoutCharges.replace`).
 * There is no `POST /payouts/sync` — ledger rows use ensure/adjust/pay flows.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_WRITE_ROLES]);
  return withIdempotency(
    req,
    actor,
    { route: "POST /payouts/charges/replace" },
    async () => {
      const body = await parseJsonBody(req);
      const result = await payoutService.replacePayoutCharges(body, { actor });
      return respondValidated(result, ledgerReplaceResultDtoSchema);
    }
  );
});
