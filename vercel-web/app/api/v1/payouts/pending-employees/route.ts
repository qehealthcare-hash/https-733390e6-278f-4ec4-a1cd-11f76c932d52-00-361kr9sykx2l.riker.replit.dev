/**
 * GET /api/v1/payouts/pending-employees?period=YYYY-MM
 *
 * Period-scoped list of every employee with outstanding payout balance
 * sourced from the duty calendar (`hh_payout_charges`) minus disbursements
 * (`hh_paid_transactions`). Each row carries name + any existing
 * `hh_payouts` id/status so the UI can deep-link to "Open in payouts" or
 * "Ensure payout" actions.
 *
 * RBAC: any role that can read the payout ledger (`PAYOUT_READ_ROLES`).
 */

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_READ_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_READ_ROLES]);
  const url = new URL(req.url);
  const result = await payoutService.pendingEmployeesForPeriod(
    { period: url.searchParams.get("period") || "" },
    { actor }
  );
  return respond(result);
});
