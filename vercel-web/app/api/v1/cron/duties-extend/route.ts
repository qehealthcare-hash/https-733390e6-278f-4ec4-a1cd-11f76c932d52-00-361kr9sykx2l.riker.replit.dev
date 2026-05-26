import type { NextRequest } from "next/server";
import { withoutAuth } from "@/lib/api/handler";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";
import { failure, success } from "@/utils/apiResponse";
import { ErrorCodes } from "@/types/common";

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
 *
 * Returns the canonical `{ success, data?, error?, code? }` envelope via
 * `respond()` so cron monitoring sees a uniform shape (no thrown
 * exceptions surfacing as bare HTTP 500s).
 */
export const GET = withoutAuth(async (req: NextRequest) => {
  const ranAt = new Date().toISOString();
  const secret = process.env.CRON_SECRET || process.env.DUTY_CRON_SECRET || "";
  const isProd =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      return respond(
        failure(
          "CRON_SECRET (or DUTY_CRON_SECRET) is not set in production — refusing to run unauthenticated",
          ErrorCodes.internal,
          { ranAt }
        )
      );
    }
  } else {
    const header = req.headers.get("authorization") || "";
    const legacy = req.headers.get("x-cron-secret") || "";
    const ok = header === `Bearer ${secret}` || legacy === secret;
    if (!ok) {
      return respond(failure("Cron token missing or invalid", ErrorCodes.forbidden));
    }
  }

  const actor = {
    email: "cron@hominal.system",
    role: "Admin",
    accessToken: ""
  };
  const result = await dutyService.extendActive({ actor });
  if (!result.success) {
    return respond(
      failure(result.error || result.code || "extendActive failed", ErrorCodes.internal, {
        ranAt,
        ...(typeof result.details === "object" && result.details !== null
          ? (result.details as Record<string, unknown>)
          : {})
      })
    );
  }

  const errCount = result.data?.errors?.length ?? 0;
  if (errCount > 0) {
    return respond(
      failure(`extendActive finished with ${errCount} duty error(s)`, ErrorCodes.internal, {
        summary: result.data,
        ranAt
      })
    );
  }

  return respond(success({ ok: true, summary: result.data, error: null, ranAt }));
});
