import type { NextRequest } from "next/server";
import { withoutAuth } from "@/lib/api/handler";
import { timingSafeEqualString } from "@/lib/api/security";
import { withIdempotency } from "@/lib/api/idempotency";
import type { ActorContext } from "@/lib/api/auth";
import { dutyService } from "@/services/dutyService";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { dutiesExtendCronResultDtoSchema } from "@/validation/cronDto";
import { failure, success } from "@/utils/apiResponse";
import { ErrorCodes } from "@/types/common";
import { crmTodayIso } from "@/utils/crmToday";

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
 */
export const GET = withoutAuth(async (req: NextRequest) => {
  const ranAt = new Date().toISOString();
  const secret = process.env.CRON_SECRET || process.env.DUTY_CRON_SECRET || "";

  if (!secret) {
    return respond(
      failure(
        "CRON_SECRET (or DUTY_CRON_SECRET) is not set — refusing to run unauthenticated",
        ErrorCodes.internal,
        { ranAt }
      )
    );
  }

  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!bearer || !timingSafeEqualString(bearer, secret)) {
    return respond(failure("Cron token missing or invalid", ErrorCodes.forbidden));
  }

  const serviceJwt =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!serviceJwt) {
    return respond(
      failure(
        "SUPABASE_SERVICE_ROLE_KEY is not set — cron cannot mint a service-account JWT",
        ErrorCodes.internal,
        { ranAt }
      )
    );
  }

  const actor: ActorContext = {
    userId: "cron",
    email: "cron@hominal.system",
    username: "cron",
    role: "Admin",
    accessToken: serviceJwt
  };

  return withIdempotency(
    req,
    actor,
    {
      route: `cron/duties-extend:${crmTodayIso()}:${ranAt.slice(0, 13)}:${req.nextUrl.searchParams.get("limit") || 500}`,
      ttlMs: 5 * 60 * 1000
    },
    async function runCronExtend() {
      const limit = Math.max(
        1,
        Math.min(1000, Number(req.nextUrl.searchParams.get("limit") || 500) || 500)
      );
      const from = crmTodayIso();
      const to = crmTodayIso();
      const result = await dutyService.bulkExtendDue(
        { actor },
        { from, to, limit }
      );
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

      const ledger = await dutyService.syncDutyAttendancePayoutLedger(
        { actor },
        { from, to }
      );
      if (!ledger.success) {
        return respond(
          failure(
            ledger.error || ledger.code || "duty ledger reconciliation failed",
            ErrorCodes.internal,
            {
              ranAt,
              materialized: result.data,
              ...(typeof ledger.details === "object" && ledger.details !== null
                ? (ledger.details as Record<string, unknown>)
                : {})
            }
          )
        );
      }

      return respondValidated(
        success({
          ok: true as const,
          summary: result.data,
          ledger: ledger.data,
          error: null,
          ranAt
        }),
        dutiesExtendCronResultDtoSchema
      );
    }
  );
});
