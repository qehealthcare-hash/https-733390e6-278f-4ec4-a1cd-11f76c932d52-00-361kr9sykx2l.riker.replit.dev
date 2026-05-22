import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { inquiryService } from "@/services/inquiryService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inquiries/sync
 *
 * Legacy SPA upsert — accepts the `toSbInquiry()` column set and routes
 * through `inquiryService.syncLegacy` (audited, RLS-scoped).
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive"]);
  return withIdempotency(req, actor, { route: "POST /inquiries/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await inquiryService.syncLegacy(body, { actor });
    return respond(result);
  });
});
