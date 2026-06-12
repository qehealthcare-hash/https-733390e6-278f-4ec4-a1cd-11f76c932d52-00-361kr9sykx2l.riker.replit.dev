import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";

export const EMPLOYEES_BASE = "/employees";

export const employeesClient = {
  basePath: EMPLOYEES_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return request(withQuery(EMPLOYEES_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(EMPLOYEES_BASE + "/" + encodeURIComponent(id), null, session);
  },

  links(session: ApiSession, id: string) {
    return request(EMPLOYEES_BASE + "/" + encodeURIComponent(id) + "/links", null, session);
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) {
      return requestWithOfflineFallback(
        EMPLOYEES_BASE + "/" + encodeURIComponent(id),
        { method: "PUT", body },
        session
      );
    }
    return requestWithOfflineFallback(EMPLOYEES_BASE, { method: "POST", body }, session);
  },

  setStatus(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      EMPLOYEES_BASE + "/" + encodeURIComponent(id) + "/status",
      { method: "POST", body },
      session
    );
  },

  remove(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestWithOfflineFallback(
      EMPLOYEES_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || {} },
      session
    );
  }
};
