import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const DOCTORS_BASE = "/doctors";

export const doctorsClient = {
  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(DOCTORS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(DOCTORS_BASE + "/" + encodeURIComponent(id), null, session);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestWithOfflineFallback(DOCTORS_BASE + "/" + encodeURIComponent(id), { method: "PATCH", body }, session);
    }
    return requestWithOfflineFallback(DOCTORS_BASE, { method: "POST", body }, session);
  },

  remove(session: ApiSession, id: string) {
    return requestWithOfflineFallback(DOCTORS_BASE + "/" + encodeURIComponent(id), { method: "DELETE" }, session);
  }
};
