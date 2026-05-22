/**
 * @deprecated — use `@/services/reportService` instead.
 *
 * Adapter for older `lib/api/*` callers that expect throw-based services
 * and bare data payloads (no ApiResult envelope). DO NOT add new methods
 * here. Migrate consumers to `@/services/reportService`.
 */

import type { ActorContext } from "../auth";
import { reportService as nextReportService, type ActorLike } from "@/services/reportService";
import { unwrap } from "@/lib/api/apiResultBridge";

function toActor(actor: ActorContext): ActorLike {
  return {
    email: actor.email,
    role: actor.role,
    accessToken: actor.accessToken
  };
}

/** Fallback actor when legacy callsites don't pass one. */
const SYSTEM_ACTOR: ActorLike = { email: "system@hominal" };

export const reportService = {
  async dashboard(month?: string, actor?: ActorContext) {
    const result = await nextReportService.dashboard(
      { period: month },
      { actor: actor ? toActor(actor) : SYSTEM_ACTOR }
    );
    return unwrap(result);
  },

  async payroll(month?: string, actor?: ActorContext) {
    const result = await nextReportService.payroll(
      { period: month },
      { actor: actor ? toActor(actor) : SYSTEM_ACTOR }
    );
    return unwrap(result);
  }
};
