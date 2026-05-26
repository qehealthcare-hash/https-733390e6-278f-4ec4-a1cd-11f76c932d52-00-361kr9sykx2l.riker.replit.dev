/**
 * GET /api/v1/payouts/pending?employee_id=…&period=YYYY-MM
 *
 * Period-scoped "pending payout" sourced straight from the duty calendar
 * (`hh_payout_charges`) minus disbursements (`hh_paid_transactions`).
 * Works even before an `hh_payouts` row exists, so the duty calendar can
 * render the pending pill without first calling /payouts (ensure).
 *
 * Auth: any provisioned actor. The duty calendar already shows charged
 * amounts; we don't add a separate role gate here.
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
  const result = await payoutService.pendingForEmployeePeriod(
    {
      employee_id: url.searchParams.get("employee_id") || "",
      period: url.searchParams.get("period") || ""
    },
    { actor }
  );
  return respond(result);
});
