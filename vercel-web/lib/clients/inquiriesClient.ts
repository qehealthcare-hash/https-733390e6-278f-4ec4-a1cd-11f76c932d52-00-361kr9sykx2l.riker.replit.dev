import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";
import {
  inquiryConvertResultDtoSchema,
  inquiryDetailDtoSchema,
  inquiryListResponseDtoSchema,
  inquiryRemoveResultDtoSchema,
} from "@/validation/inquiryDto";

export const INQUIRIES_BASE = "/inquiries";

function inquiryPath(id: string, suffix = "") {
  return INQUIRIES_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const inquiriesClient = {
  basePath: INQUIRIES_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return requestValidated(withQuery(INQUIRIES_BASE, params), null, session, inquiryListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(inquiryPath(id), null, session, inquiryDetailDtoSchema);
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) {
      return requestValidatedWithOfflineFallback(inquiryPath(id), { method: "PUT", body }, session, inquiryDetailDtoSchema);
    }
    return requestValidatedWithOfflineFallback(INQUIRIES_BASE, { method: "POST", body }, session, inquiryDetailDtoSchema);
  },

  setStatus(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      inquiryPath(id, "/status"),
      { method: "POST", body },
      session,
      inquiryDetailDtoSchema
    );
  },

  remove(
    session: ApiSession,
    id: string,
    body: Record<string, unknown>,
    hard?: boolean
  ) {
    const suffix = hard ? "?hard=1" : "";
    return requestValidatedWithOfflineFallback(
      inquiryPath(id) + suffix,
      { method: "DELETE", body },
      session,
      inquiryRemoveResultDtoSchema
    );
  },

  convert(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      inquiryPath(id, "/convert"),
      { method: "POST", body },
      session,
      inquiryConvertResultDtoSchema
    );
  }
};
