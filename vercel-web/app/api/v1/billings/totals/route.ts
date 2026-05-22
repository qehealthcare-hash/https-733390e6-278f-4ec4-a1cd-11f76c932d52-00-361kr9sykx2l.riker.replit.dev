import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes, type ApiResult } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/billings/totals?period=YYYY-MM
 *
 * Sum of svc_entries.total for the given month across every billing.
 * Dashboard / report screens call this so their "billing total" matches the
 * value on the invoice screen byte-for-byte.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const period = new URL(req.url).searchParams.get("period") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    const result: ApiResult<never> = {
      success: false,
      error: "period must be YYYY-MM",
      code: ErrorCodes.badRequest
    };
    return respond(result);
  }
  const result = await billingService.monthlyServiceTotal(period, { actor });
  return respond(result);
});
