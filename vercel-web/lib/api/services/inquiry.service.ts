/**
 * @deprecated — use `@/services/inquiryService` instead.
 *
 * Adapter for older `lib/api/*` callers that expect throw-based services
 * and bare data payloads (no ApiResult envelope). DO NOT add new methods
 * here. Migrate consumers to `@/services/inquiryService`.
 */

import type { ActorContext } from "../auth";
import { inquiryService as nextInquiryService, type ActorLike } from "@/services/inquiryService";
import { unwrap } from "@/lib/api/apiResultBridge";

// Re-export validation surface so legacy imports keep compiling.
export {
  inquirySchema,
  inquiryStatusSchema,
  inquiryConvertSchema,
  inquiryListQuerySchema,
  INQUIRY_STATUSES,
  INQUIRY_OPEN_STATUSES,
  INQUIRY_CLOSED_STATUSES,
  type InquiryInput,
  type InquiryStatus,
  type InquiryStatusInput,
  type InquiryConvertInput,
  type InquiryListQuery
} from "@/validation/inquiryValidation";

import type {
  InquiryInput,
  InquiryStatusInput,
  InquiryConvertInput
} from "@/validation/inquiryValidation";

function toActor(actor: ActorContext): ActorLike {
  return {
    email: actor.email,
    userId: actor.userId,
    role: actor.role,
    accessToken: actor.accessToken
  };
}

export const inquiryService = {
  async list(opts: { limit: number; offset: number; q: string }) {
    const SYSTEM_ACTOR: ActorLike = { email: "system@hominal" };
    const result = await nextInquiryService.list(opts, { actor: SYSTEM_ACTOR });
    return unwrap(result);
  },

  async getById(id: string) {
    const SYSTEM_ACTOR: ActorLike = { email: "system@hominal" };
    const result = await nextInquiryService.getById(id, { actor: SYSTEM_ACTOR });
    return unwrap(result);
  },

  async create(input: InquiryInput, actor: ActorContext) {
    const result = await nextInquiryService.create(input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async update(id: string, input: InquiryInput, actor: ActorContext) {
    const result = await nextInquiryService.update(id, input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async setStatus(id: string, input: InquiryStatusInput, actor: ActorContext) {
    const result = await nextInquiryService.setStatus(id, input, { actor: toActor(actor) });
    return unwrap(result);
  },

  async remove(id: string, actor: ActorContext) {
    const result = await nextInquiryService.remove(id, { actor: toActor(actor) });
    return unwrap(result);
  },

  async convertToPatient(id: string, actor: ActorContext, input?: InquiryConvertInput) {
    const result = await nextInquiryService.convertToPatient(
      id,
      input ?? {},
      { actor: toActor(actor) }
    );
    return unwrap(result);
  }
};
