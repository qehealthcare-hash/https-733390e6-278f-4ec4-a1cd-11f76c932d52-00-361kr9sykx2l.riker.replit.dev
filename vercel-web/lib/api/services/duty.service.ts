/**
 * @deprecated Use `@/services/dutyService` instead.
 *
 * Re-exports for code that still imports `dutySchema` / `dutyService` from
 * this legacy path. New routes use the layered service in
 * `src/services/dutyService.ts` which returns `ApiResult<T>`.
 *
 * Keep this shim around until Phase 7c migrates the legacy SPA off direct
 * Supabase calls. After that, this file can be deleted.
 */

import { dutyService as layeredDutyService } from "@/services/dutyService";
import type { ActorContext } from "@/lib/api/auth";
import type { DutyInput } from "@/validation/dutyValidation";
import { unwrap } from "@/lib/api/apiResultBridge";

export {
  dutySchema,
  dutyCheckAtSchema,
  dutyCancelSchema,
  type DutyInput,
  type DutyCheckAtInput,
  type DutyCancelInput
} from "@/validation/dutyValidation";

/**
 * Legacy {data} or throw facade. Internally calls the new layered
 * `dutyService` and converts `ApiResult` failures into the `ApiError`
 * shape the old `withAuth` middleware expects.
 */
export const dutyService = {
  async list(opts: {
    limit: number;
    offset: number;
    q: string;
    employeeId?: string;
    patientId?: string;
    from?: string;
    to?: string;
  }) {
    const result = await layeredDutyService.list(
      {
        limit: opts.limit,
        offset: opts.offset,
        q: opts.q,
        employee_id: opts.employeeId,
        patient_id: opts.patientId,
        from: opts.from,
        to: opts.to
      },
      { actor: { email: "system" } }
    );
    return unwrap(result);
  },

  async getById(id: string) {
    return unwrap(await layeredDutyService.getById(id, { actor: { email: "system" } }));
  },

  async create(input: DutyInput, actor: ActorContext) {
    return unwrap(await layeredDutyService.create(input, { actor }));
  },

  async update(id: string, input: DutyInput, actor: ActorContext) {
    return unwrap(await layeredDutyService.update(id, input, { actor }));
  },

  async cancel(id: string, reason: string, actor: ActorContext) {
    return unwrap(await layeredDutyService.cancel(id, { reason }, { actor }));
  },

  async checkIn(id: string, when: string | undefined, actor: ActorContext) {
    return unwrap(await layeredDutyService.checkIn(id, when, { actor }));
  },

  async checkOut(id: string, when: string | undefined, actor: ActorContext) {
    return unwrap(await layeredDutyService.checkOut(id, when, { actor }));
  }
};
