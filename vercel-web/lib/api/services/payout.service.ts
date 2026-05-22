/**
 * @deprecated — use `@/services/payoutService` instead.
 *
 * This shim adapts the new ApiResult-returning service to the legacy
 * throw-based contract expected by older `lib/api/*` callers.
 *
 * DO NOT add new methods here. Migrate consumers to `@/services/payoutService`.
 */

import type { ActorContext } from "../auth";
import {
  payoutService as nextPayoutService,
  type ActorLike
} from "@/services/payoutService";
import { unwrap } from "@/lib/api/apiResultBridge";

// Re-export schemas + types so existing imports keep compiling.
export {
  payoutSchema,
  payoutAdjustmentSchema,
  payoutPaySchema,
  payoutLockSchema,
  payoutReopenSchema,
  payoutRecomputeSchema,
  payoutListQuerySchema,
  type PayoutInput,
  type PayoutAdjustmentInput,
  type PayoutPayInput,
  type PayoutLockInput,
  type PayoutReopenInput,
  type PayoutRecomputeInput,
  type PayoutListQuery
} from "@/validation/payoutValidation";

import type {
  PayoutInput,
  PayoutAdjustmentInput,
  PayoutPayInput
} from "@/validation/payoutValidation";

function toActor(actor: ActorContext): ActorLike {
  return {
    email: actor.email,
    userId: actor.userId,
    role: actor.role,
    accessToken: actor.accessToken
  };
}

export const payoutService = {
  async list(opts: {
    limit: number;
    offset: number;
    period?: string;
    employeeId?: string;
    status?: string;
  }) {
    // Legacy callers expect `{ rows, total }`.
    const fakeActor = { email: "system@hominal" } as ActorContext;
    const result = await nextPayoutService.list(
      {
        limit: opts.limit,
        offset: opts.offset,
        period: opts.period,
        employee_id: opts.employeeId,
        status: opts.status
      },
      { actor: toActor(fakeActor) }
    );
    return unwrap(result);
  },

  async getById(id: string) {
    // The new service returns `{ payout, duties, attendance, breakdown }`;
    // legacy callers expected just the payout row. Preserve that shape.
    const fakeActor = { email: "system@hominal" } as ActorContext;
    const result = await nextPayoutService.getById(id, { actor: toActor(fakeActor) });
    const detail = unwrap(result);
    return detail.payout;
  },

  async ensure(input: PayoutInput, actor: ActorContext) {
    const result = await nextPayoutService.ensure(input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async adjust(input: PayoutAdjustmentInput, actor: ActorContext) {
    const result = await nextPayoutService.adjust(input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async markPaid(input: PayoutPayInput, actor: ActorContext) {
    const result = await nextPayoutService.markPaid(input, { actor: toActor(actor) });
    return unwrap(result);
  }
};
