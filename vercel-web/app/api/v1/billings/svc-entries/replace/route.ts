import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_WRITE_ROLES } from "@/lib/api/billingRoles";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/billings/svc-entries/replace
 *
 * Atomically replaces the entire `hh_svc_entries` slice for one `svc_key`
 * (duty-diary save). Body shape: `{ svc_key, rows: [...] }`. Refuses when
 * the parent billing is Closed or Cancelled.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_WRITE_ROLES]);
  return withIdempotency(
    req,
    actor,
    { route: "POST /billings/svc-entries/replace" },
    async () => {
      const body = await parseJsonBody(req);
      const result = await billingService.replaceServiceEntries(body, { actor });
      return respond(result);
    }
  );
});
