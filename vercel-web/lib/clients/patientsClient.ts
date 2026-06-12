import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";

export const PATIENTS_BASE = "/patients";

export const patientsClient = {
  basePath: PATIENTS_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return request(withQuery(PATIENTS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(PATIENTS_BASE + "/" + encodeURIComponent(id), null, session);
  },

  create(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(PATIENTS_BASE, { method: "POST", body }, session);
  },

  update(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "PUT", body },
      session
    );
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) return this.update(session, id, body);
    return this.create(session, body);
  },

  close(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || {} },
      session
    );
  },

  reopen(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "/reopen",
      { method: "POST", body: body || {} },
      session
    );
  },

  hardDelete(session: ApiSession, id: string) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "?hard=1",
      { method: "DELETE" },
      session
    );
  },

  history(session: ApiSession, id: string) {
    return request(PATIENTS_BASE + "/" + encodeURIComponent(id) + "/history", null, session);
  }
};
