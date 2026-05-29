import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_ADJUST_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...PAYOUT_ADJUST_ROLES]);
  const body = await parseJsonBody(req);
  const result = await payoutService.adjust(body, { actor });
  return respond(result);
});
