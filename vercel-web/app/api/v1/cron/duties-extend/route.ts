import type { NextRequest } from "next/server";
import { dutyService } from "@/services/dutyService";
import { jsonOk, forbidden, serverError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/cron/duties-extend
 *
 * Vercel Cron hits this once a day (configured in vercel.json at 19:00 UTC
 * = 00:30 IST). It materializes one new day's worth of per-day charges and
 * payouts for every SCHEDULED / IN_PROGRESS duty whose patient still has
 * an Active bill, so open-ended duties keep accruing without operator
 * action. Closed bills are skipped by the materializer itself.
 *
 * Auth: Vercel sets the `Authorization: Bearer <CRON_SECRET>` header on
 * cron invocations. We accept either:
 *   - that header (when CRON_SECRET is set), or
 *   - the legacy `x-cron-secret` header used by manual calls in staging.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DUTY_CRON_SECRET || "";
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  // Fail-closed in production. We refuse to run an unauthenticated daily
  // job that mutates financial diary rows, even if env was misconfigured.
  if (!secret) {
    if (isProd) {
      throw serverError(
        "CRON_SECRET (or DUTY_CRON_SECRET) is not set in production — refusing to run unauthenticated"
      );
    }
  } else {
    const header = req.headers.get("authorization") || "";
    const legacy = req.headers.get("x-cron-secret") || "";
    const ok = header === `Bearer ${secret}` || legacy === secret;
    if (!ok) throw forbidden("Cron token missing or invalid");
  }

  const actor = {
    email: "cron@hominal.system",
    role: "Admin",
    accessToken: ""
  };
  const result = await dutyService.extendActive({ actor });
  if (!result.success) {
    throw serverError(result.error || result.code || "extendActive failed", {
      ranAt: new Date().toISOString()
    });
  }
  const errCount = result.data?.errors?.length ?? 0;
  if (errCount > 0) {
    throw serverError(`extendActive finished with ${errCount} duty error(s)`, {
      summary: result.data,
      ranAt: new Date().toISOString()
    });
  }
  return jsonOk({
    ok: true,
    summary: result.data,
    error: null,
    ranAt: new Date().toISOString()
  });
}
