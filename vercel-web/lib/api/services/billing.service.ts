/**
 * @deprecated Use `@/services/billingService` instead.
 *
 * Re-exports for code that still imports `billingSchema` / `billingService`
 * from this legacy path. New routes use the layered service in
 * `src/services/billingService.ts` which returns `ApiResult<T>`.
 */

import { billingService as layeredBillingService } from "@/services/billingService";
import type { ActorContext } from "@/lib/api/auth";
import type {
  BillingInput,
  BillingStatus,
  GenerateFromDutyInput,
  ReceiptInput
} from "@/validation/billingValidation";
import { unwrap } from "@/lib/api/apiResultBridge";

export {
  billingSchema,
  billingStatusSchema,
  billingCloseSchema,
  billingReopenSchema,
  billingEditSchema,
  receiptSchema,
  generateFromDutySchema,
  generateFromDutyRangeSchema,
  DEFAULT_SHIFT_RATES,
  BILLING_STATUSES,
  type BillingInput,
  type BillingStatus,
  type BillingStatusInput,
  type BillingCloseInput,
  type BillingReopenInput,
  type ReceiptInput,
  type ShiftRates,
  type GenerateFromDutyInput,
  type GenerateFromDutyRangeInput
} from "@/validation/billingValidation";

export { amountForShift } from "@/business/billingRules";

/**
 * Legacy "throw on failure" facade — converts `ApiResult` from the new
 * layered service into the throw-based shape expected by old call sites.
 */
export const billingService = {
  async listByPatient(patientId: string, actor?: ActorContext) {
    return unwrap(
      await layeredBillingService.listByPatient(patientId, {
        actor: actor || { email: "system" }
      })
    );
  },

  async create(input: BillingInput, actor: ActorContext) {
    return unwrap(await layeredBillingService.create(input, { actor }));
  },

  async updateStatus(id: string, status: BillingStatus, actor: ActorContext) {
    return unwrap(await layeredBillingService.setStatus(id, { status }, { actor }));
  },

  async generateFromDuty(input: GenerateFromDutyInput, actor: ActorContext) {
    return unwrap(await layeredBillingService.generateFromDuty(input, { actor }));
  },

  async recordPayment(input: ReceiptInput, actor: ActorContext) {
    return unwrap(await layeredBillingService.recordPayment(input, { actor }));
  },

  async invoicePayload(billingId: string, actor?: ActorContext) {
    return unwrap(
      await layeredBillingService.invoicePayload(billingId, {
        actor: actor || { email: "system" }
      })
    );
  }
};
