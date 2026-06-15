import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";
import {
  patientDetailDtoSchema,
  patientHardDeleteResultDtoSchema,
  patientHistoryDtoSchema,
  patientListResponseDtoSchema,
} from "@/validation/patientDto";

export const PATIENTS_BASE = "/patients";

export const patientsClient = {
  basePath: PATIENTS_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return requestValidated(withQuery(PATIENTS_BASE, params), null, session, patientListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(PATIENTS_BASE + "/" + encodeURIComponent(id), null, session, patientDetailDtoSchema);
  },

  create(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(PATIENTS_BASE, { method: "POST", body }, session, patientDetailDtoSchema);
  },

  update(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "PUT", body },
      session,
      patientDetailDtoSchema
    );
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) return this.update(session, id, body);
    return this.create(session, body);
  },

  close(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || {} },
      session,
      patientDetailDtoSchema
    );
  },

  reopen(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "/reopen",
      { method: "POST", body: body || {} },
      session,
      patientDetailDtoSchema
    );
  },

  hardDelete(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "?hard=1",
      { method: "DELETE" },
      session,
      patientHardDeleteResultDtoSchema
    );
  },

  history(session: ApiSession, id: string) {
    return requestValidated(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "/history",
      null,
      session,
      patientHistoryDtoSchema
    );
  }
};
