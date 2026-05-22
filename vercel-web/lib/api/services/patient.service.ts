/**
 * @deprecated — use `@/services/patientService` instead.
 *
 * Re-exports for code that still imports from this legacy path.
 * New routes use the layered service in `src/services/patientService.ts`.
 */

import type { ActorContext } from "../auth";
import { patientService as nextPatientService, type ActorLike } from "@/services/patientService";
import { unwrap } from "@/lib/api/apiResultBridge";

export {
  patientSchema,
  patientAssignSchema,
  patientListQuerySchema,
  PATIENT_STATUSES,
  type PatientInput,
  type PatientAssignInput,
  type PatientListQuery
} from "@/validation/patientValidation";

import type { PatientInput, PatientAssignInput } from "@/validation/patientValidation";

function toActor(actor: ActorContext): ActorLike {
  return {
    email: actor.email,
    role: actor.role,
    accessToken: actor.accessToken
  };
}

const SYSTEM: ActorLike = { email: "system@hominal" };

export const patientService = {
  async list(opts: { limit: number; offset: number; q: string; status?: string }) {
    const result = await nextPatientService.list(opts, { actor: SYSTEM });
    return unwrap(result);
  },

  async getById(id: string) {
    const result = await nextPatientService.getById(id, { actor: SYSTEM });
    return unwrap(result);
  },

  async create(input: PatientInput, actor: ActorContext) {
    const result = await nextPatientService.create(input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async update(id: string, input: PatientInput, actor: ActorContext) {
    const result = await nextPatientService.update(id, input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async remove(id: string, actor: ActorContext) {
    const result = await nextPatientService.remove(id, { actor: toActor(actor) });
    return unwrap(result);
  },

  async assignCaretaker(id: string, caretakerId: string, shift: string, actor: ActorContext) {
    const result = await nextPatientService.assignCaretaker(
      id,
      { caretaker_id: caretakerId, shift },
      { actor: toActor(actor) }
    );
    return unwrap(result);
  },

  async history(id: string) {
    const result = await nextPatientService.history(id, { actor: SYSTEM });
    return unwrap(result);
  }
};
