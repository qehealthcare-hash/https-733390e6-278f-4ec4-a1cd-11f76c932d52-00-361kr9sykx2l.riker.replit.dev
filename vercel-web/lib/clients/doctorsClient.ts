import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  doctorDeleteResultDtoSchema,
  doctorListResponseDtoSchema,
  doctorRowDtoSchema,
} from "@/validation/doctorDto";

export const DOCTORS_BASE = "/doctors";

export const doctorsClient = {
  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(DOCTORS_BASE, params), null, session, doctorListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(DOCTORS_BASE + "/" + encodeURIComponent(id), null, session, doctorRowDtoSchema);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestValidatedWithOfflineFallback(
        DOCTORS_BASE + "/" + encodeURIComponent(id),
        { method: "PATCH", body },
        session,
        doctorRowDtoSchema
      );
    }
    return requestValidatedWithOfflineFallback(DOCTORS_BASE, { method: "POST", body }, session, doctorRowDtoSchema);
  },

  remove(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      DOCTORS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE" },
      session,
      doctorDeleteResultDtoSchema
    );
  }
};
