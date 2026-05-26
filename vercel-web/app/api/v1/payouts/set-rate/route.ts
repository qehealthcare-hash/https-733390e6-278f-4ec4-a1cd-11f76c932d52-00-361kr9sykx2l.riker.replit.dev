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
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { PAYOUT_WRITE_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_WRITE_ROLES]);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return withIdempotency(
    req,
    actor,
    { route: "POST /payouts/set-rate" },
    async () => {
      const result = await payoutService.setEmployeePeriodPayoutRate(body, { actor });
      return respond(result);
    }
  );
});
