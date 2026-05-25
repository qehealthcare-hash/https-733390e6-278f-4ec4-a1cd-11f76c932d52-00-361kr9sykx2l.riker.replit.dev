import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/duties/extend-active
 *
 * Daily catch-up job. For every SCHEDULED / IN_PROGRESS duty whose
 * patient still has an Active bill, materialize per-day charges + payouts
 * up to today. Open-ended duties accrue one new day each time this runs.
 *
 * Intended to be hit by a Vercel Cron (daily at 00:30 IST). Also safe to
 * call manually from the UI as a "Sync today" action.
 */
export const POST = withAuth(async (_req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const result = await dutyService.extendActive({ actor });
  return respond(result);
});
