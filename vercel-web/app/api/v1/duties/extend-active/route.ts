import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_EXTEND_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { dutyService } from "@/services/dutyService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyExtendActiveResultDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/duties/extend-active
 *
 * Daily catch-up job. For every SCHEDULED / IN_PROGRESS duty whose
 * patient still has an Active bill, materialize per-day charges + payouts
 * up to today. Open-ended duties accrue one new day each time this runs.
 *
 * **Operational quarantine (M7-G):** invoked by cron or Admin/Manager manual
 * catch-up — not used by the modern Next.js calendar for normal edits.
 *
 * Auth: `DUTY_EXTEND_ROLES` (Admin/Manager only). Staff was removed (P1-16) —
 * an honest mistake
 * by an over-eager nurse triple-tapping "Sync today" was generating 3x
 * duplicate payout rows before the underlying RPC's advisory lock landed.
 *
 * Idempotency: 1-hour cooldown (ttlMs = 60 * 60 * 1000). The synthesized
 * key is (actor + route + body) so a single operator click is replayed
 * for an hour; cron retries within an hour return the cached envelope.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, DUTY_EXTEND_ROLES);
  return withIdempotency(
    req,
    actor,
    { route: "POST /api/v1/duties/extend-active", ttlMs: 60 * 60 * 1000 },
    async () => {
      const result = await dutyService.extendActive({ actor });
      return respondValidated(result, dutyExtendActiveResultDtoSchema);
    }
  );
});
