import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/billings/[id]/close
 *
 * Closes a bill. Refuses if no service entries exist, or if there's
 * outstanding > 0 (unless `force=true` from an Admin).
 *
 * Body: `{ reason?: string; force?: boolean }`
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await billingService.close(params.id, body, { actor });
  return respond(result);
});
