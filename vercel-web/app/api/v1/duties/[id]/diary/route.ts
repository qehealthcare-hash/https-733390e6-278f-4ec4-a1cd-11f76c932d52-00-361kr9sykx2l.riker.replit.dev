import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_READ_ROLES } from "@/business/rbac";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { diaryListResultDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * GET /api/v1/duties/[id]/diary
 *
 * List the per-day materialized diary slots for a duty. Each entry
 * surfaces the current charge, payout, and whether it has been
 * manually edited (so the next sync will leave it alone).
 */
export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, DUTY_READ_ROLES);
  const result = await dutyDiaryService.listDays(params.id, { actor });
  return respondValidated(result, diaryListResultDtoSchema);
});
