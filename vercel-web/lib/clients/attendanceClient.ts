import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const ATTENDANCE_BASE = "/attendance";

export const attendanceClient = {
  dayBoard(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(ATTENDANCE_BASE + "/day", params), null, session);
  },

  markDay(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(ATTENDANCE_BASE + "/day/mark", { method: "POST", body }, session);
  },

  range(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(ATTENDANCE_BASE + "/range", params), null, session);
  },

  missing(session: ApiSession, params: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(ATTENDANCE_BASE + "/missing", params), null, session);
  },

  mark(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(ATTENDANCE_BASE + "/mark", { method: "POST", body }, session);
  },

  update(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(ATTENDANCE_BASE + "/" + encodeURIComponent(id), { method: "PATCH", body }, session);
  },

  remove(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestWithOfflineFallback(
      ATTENDANCE_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || undefined },
      session
    );
  }
};
