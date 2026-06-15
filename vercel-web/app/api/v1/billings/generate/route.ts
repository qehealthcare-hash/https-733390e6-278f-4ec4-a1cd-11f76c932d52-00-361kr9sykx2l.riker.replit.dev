import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { generateFromDutyResultDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/billings/generate
 *
 * Generate a billing service-entry from a single duty.
 *
 *   body: GenerateFromDutyInput
 *
 * - If the duty is already linked to a bill with the same service+date,
 *   returns the existing row with `duplicate: true` so the UI is idempotent.
 * - Refuses if the linked bill is Closed.
 * - Pins the bill's date to the duty's `start_at` so it lands in the right
 *   billing month.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /billings/generate" }, async () => {
    const body = await parseJsonBody(req);
    const result = await billingService.generateFromDuty(body, { actor });
    return respondValidated(result, generateFromDutyResultDtoSchema, 201);
  });
});
