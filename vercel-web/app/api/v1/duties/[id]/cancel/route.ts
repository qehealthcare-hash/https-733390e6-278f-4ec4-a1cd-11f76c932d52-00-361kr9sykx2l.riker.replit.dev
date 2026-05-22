import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/duties/[id]/cancel
 *
 * Soft-cancels a duty (status = CANCELLED) and reverses its billing service
 * entry when safe. Refuses if receipts have already been recorded.
 *
 * Body: `{ reason?: string }`
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const result = await dutyService.cancel(params.id, body, { actor });
  return respond(result);
});
