import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES } from "@/lib/api/billingRoles";
import { reportService } from "@/services/reportService";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/billings/totals?period=YYYY-MM
 *
 * Delegates to the same report totals used by Reports → Billing so there is
 * one definition of monthly billing totals across the app.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const period = new URL(req.url).searchParams.get("period") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return respond({
      success: false,
      error: "period must be YYYY-MM",
      code: ErrorCodes.badRequest
    });
  }
  const result = await reportService.billingTotals({ period }, { actor });
  return respond(result);
});
