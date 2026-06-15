import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { INQUIRY_SYNC_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { inquiryService } from "@/services/inquiryService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { inquiryRowDtoSchema } from "@/validation/inquiryDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inquiries/sync
 *
 * **Legacy quarantine (M4-G):** still required by `public/lib/legacy-api.js`
 * (`HominalApi.inquiries.sync` → `toSbInquiry()` upserts with client `INQ…`
 * ids). Do not remove until the legacy SPA is fully retired. The modern
 * Next.js inquiries page uses `POST /inquiries` and `PATCH /inquiries/:id`
 * instead. Access is Admin/Manager-only (`INQUIRY_SYNC_ROLES`).
 *
 * Routes through `inquiryService.syncLegacy` (audited, RLS-scoped).
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, INQUIRY_SYNC_ROLES);
  return withIdempotency(req, actor, { route: "POST /inquiries/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await inquiryService.syncLegacy(body, { actor });
    return respondValidated(result, inquiryRowDtoSchema);
  });
});
