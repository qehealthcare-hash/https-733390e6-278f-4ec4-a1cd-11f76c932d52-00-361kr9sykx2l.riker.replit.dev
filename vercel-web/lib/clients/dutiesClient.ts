import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const DUTIES_BASE = "/duties";

function dutyPath(id: string, suffix = "") {
  return DUTIES_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const dutiesClient = {
  basePath: DUTIES_BASE,

  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(DUTIES_BASE, params), null, session);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestWithOfflineFallback(dutyPath(id), { method: "PATCH", body }, session);
    }
    return requestWithOfflineFallback(DUTIES_BASE, { method: "POST", body }, session);
  },

  diary(session: ApiSession, id: string) {
    return request(dutyPath(id, "/diary"), null, session);
  },

  diaryBatch(session: ApiSession, dutyIds: string[]) {
    return request(DUTIES_BASE + "/diary/batch", { method: "POST", body: { duty_ids: dutyIds } }, session);
  },

  totals(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(DUTIES_BASE + "/totals", params), null, session);
  },

  materialize(session: ApiSession, id: string, body: Record<string, unknown> = {}) {
    return requestWithOfflineFallback(
      dutyPath(id, "/materialize"),
      { method: "POST", body },
      session
    );
  },

  cancel(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(dutyPath(id, "/cancel"), { method: "POST", body }, session);
  },

  hardDelete(session: ApiSession, id: string) {
    return requestWithOfflineFallback(dutyPath(id) + "?hard=1", { method: "DELETE" }, session);
  },

  patchDiaryDay(session: ApiSession, dutyId: string, date: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      dutyPath(dutyId, "/diary/" + encodeURIComponent(date)),
      { method: "PATCH", body },
      session
    );
  },

  deleteDiaryDay(session: ApiSession, dutyId: string, date: string, employeeId: string) {
    return requestWithOfflineFallback(
      dutyPath(dutyId, "/diary/" + encodeURIComponent(date)) +
        "?employee_id=" +
        encodeURIComponent(employeeId),
      { method: "DELETE" },
      session
    );
  },

  runAction(session: ApiSession, id: string, action: string) {
    return requestWithOfflineFallback(dutyPath(id, "/" + action), { method: "POST", body: {} }, session);
  }
};
