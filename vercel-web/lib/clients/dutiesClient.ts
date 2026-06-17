import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  diaryBatchResponseDtoSchema,
  diaryDayDeleteResponseDtoSchema,
  diaryDayPatchResponseDtoSchema,
  diaryListResultDtoSchema,
  dutyDetailDtoSchema,
  dutyHardDeleteResponseDtoSchema,
  dutyListResponseDtoSchema,
  dutyRowDtoSchema,
  dutyMaterializeResultDtoSchema,
  dutyTotalsResponseDtoSchema,
} from "@/validation/dutyDto";

export const DUTIES_BASE = "/duties";

function dutyPath(id: string, suffix = "") {
  return DUTIES_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const dutiesClient = {
  basePath: DUTIES_BASE,

  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(DUTIES_BASE, params), null, session, dutyListResponseDtoSchema, {
      kind: "list",
      list: { rowSchema: dutyRowDtoSchema, scope: "GET /duties", idField: "id" }
    });
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestValidatedWithOfflineFallback(dutyPath(id), { method: "PATCH", body }, session, dutyDetailDtoSchema);
    }
    return requestValidatedWithOfflineFallback(DUTIES_BASE, { method: "POST", body }, session, dutyDetailDtoSchema);
  },

  diary(session: ApiSession, id: string) {
    return requestValidated(dutyPath(id, "/diary"), null, session, diaryListResultDtoSchema);
  },

  diaryBatch(session: ApiSession, dutyIds: string[]) {
    return requestValidated(
      DUTIES_BASE + "/diary/batch",
      { method: "POST", body: { duty_ids: dutyIds } },
      session,
      diaryBatchResponseDtoSchema
    );
  },

  totals(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(DUTIES_BASE + "/totals", params), null, session, dutyTotalsResponseDtoSchema);
  },

  materialize(session: ApiSession, id: string, body: Record<string, unknown> = {}) {
    return requestValidatedWithOfflineFallback(
      dutyPath(id, "/materialize"),
      { method: "POST", body },
      session,
      dutyMaterializeResultDtoSchema
    );
  },

  cancel(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(dutyPath(id, "/cancel"), { method: "POST", body }, session, dutyDetailDtoSchema);
  },

  hardDelete(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      dutyPath(id) + "?hard=1",
      { method: "DELETE" },
      session,
      dutyHardDeleteResponseDtoSchema
    );
  },

  patchDiaryDay(
    session: ApiSession,
    dutyId: string,
    date: string,
    body: Record<string, unknown>
  ) {
    return requestValidatedWithOfflineFallback(
      dutyPath(dutyId, "/diary/" + encodeURIComponent(date)),
      { method: "PATCH", body },
      session,
      diaryDayPatchResponseDtoSchema
    );
  },

  deleteDiaryDay(session: ApiSession, dutyId: string, date: string, employeeId: string) {
    return requestValidatedWithOfflineFallback(
      dutyPath(dutyId, "/diary/" + encodeURIComponent(date)) +
        "?employee_id=" +
        encodeURIComponent(employeeId),
      { method: "DELETE" },
      session,
      diaryDayDeleteResponseDtoSchema
    );
  },

  runAction(session: ApiSession, id: string, action: string) {
    return requestValidatedWithOfflineFallback(
      dutyPath(id, "/" + action),
      { method: "POST", body: {} },
      session,
      dutyDetailDtoSchema
    );
  }
};
