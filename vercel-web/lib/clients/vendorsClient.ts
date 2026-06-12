import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const VENDORS_BASE = "/vendors";

export const vendorsClient = {
  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(VENDORS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(VENDORS_BASE + "/" + encodeURIComponent(id), null, session);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestWithOfflineFallback(VENDORS_BASE + "/" + encodeURIComponent(id), { method: "PATCH", body }, session);
    }
    return requestWithOfflineFallback(VENDORS_BASE, { method: "POST", body }, session);
  },

  remove(session: ApiSession, id: string) {
    return requestWithOfflineFallback(VENDORS_BASE + "/" + encodeURIComponent(id), { method: "DELETE" }, session);
  }
};
