import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { inquiryService } from "@/services/inquiryService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/inquiries/:id/status
 *
 * Dedicated status-change endpoint. Body: `{ status, reason?, followup_date? }`.
 * Enforces `FollowUp`/`Negotiating` ⇒ `followup_date` and refuses to move
 * Converted inquiries (they are terminal — edit the patient instead).
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive"]);
  const body = await parseJsonBody(req);
  const result = await inquiryService.setStatus(params.id, body, { actor });
  return respond(result);
});
