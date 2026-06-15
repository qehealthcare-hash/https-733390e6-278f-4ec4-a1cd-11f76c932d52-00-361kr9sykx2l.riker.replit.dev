import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  vendorDeleteResultDtoSchema,
  vendorListResponseDtoSchema,
  vendorRowDtoSchema
} from "@/validation/vendorDto";

export const VENDORS_BASE = "/vendors";

export const vendorsClient = {
  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(VENDORS_BASE, params), null, session, vendorListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(VENDORS_BASE + "/" + encodeURIComponent(id), null, session, vendorRowDtoSchema);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestValidatedWithOfflineFallback(
        VENDORS_BASE + "/" + encodeURIComponent(id),
        { method: "PATCH", body },
        session,
        vendorRowDtoSchema
      );
    }
    return requestValidatedWithOfflineFallback(VENDORS_BASE, { method: "POST", body }, session, vendorRowDtoSchema);
  },

  remove(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      VENDORS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE" },
      session,
      vendorDeleteResultDtoSchema
    );
  }
};
