/**
 * POST /api/v1/payouts/set-rate
 *
 * One-click repair for "duty exists but Gross is ₹0":
 *   - Sets payout_per_day on every zero-rate duty for (employee_id, period)
 *   - Re-materializes the duty diary
 *   - Recomputes the payout
 *   - Returns the fresh PayoutDetail (so the UI can re-render the corrected
 *     total in place)
 *
 * Body: { employee_id: string, period: "YYYY-MM", payout_per_day: number }
 *
 * RBAC: PAYOUT_WRITE_ROLES (Admin / Manager / Accountant). Mirrors the
 * RBAC on /payouts (POST) — anyone allowed to ensure a payout is allowed
 * to repair its source rates.
 *
 * Idempotency: protected by `withIdempotency` so a double-click from the
 * UI doesn't run two bulk updates.
 */

import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { PAYOUT_WRITE_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_WRITE_ROLES]);
  return withIdempotency(
    req,
    actor,
    { route: "POST /payouts/set-rate" },
    async () => {
      // Parse INSIDE the wrapper so withIdempotency can still clone the
      // request to hash the body for the synthesized key. Reading the body
      // before withIdempotency disturbs the stream and the synth key would
      // collapse across distinct payloads.
      const body = await parseJsonBody(req);
      const result = await payoutService.setEmployeePeriodPayoutRate(body, { actor });
      return respond(result);
    }
  );
});
