import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PAYOUT_READ_ROLES } from "@/lib/api/payoutRoles";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...PAYOUT_READ_ROLES]);
  const result = await payoutService.getById(params.id, { actor });
  return respond(result);
});
