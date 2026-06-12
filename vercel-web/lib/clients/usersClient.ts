import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const USERS_BASE = "/users";
export const ROLES_BASE = "/roles";

export const usersClient = {
  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(USERS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(USERS_BASE + "/" + encodeURIComponent(id), null, session);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestWithOfflineFallback(USERS_BASE + "/" + encodeURIComponent(id), { method: "PATCH", body }, session);
    }
    return requestWithOfflineFallback(USERS_BASE, { method: "POST", body }, session);
  },

  deactivate(session: ApiSession, id: string) {
    return requestWithOfflineFallback(USERS_BASE + "/" + encodeURIComponent(id), { method: "DELETE" }, session);
  }
};

export const rolesClient = {
  list(session: ApiSession) {
    return request(ROLES_BASE, null, session);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestWithOfflineFallback(ROLES_BASE + "/" + encodeURIComponent(id), { method: "PATCH", body }, session);
    }
    return requestWithOfflineFallback(ROLES_BASE, { method: "POST", body }, session);
  },

  remove(session: ApiSession, id: string) {
    return requestWithOfflineFallback(ROLES_BASE + "/" + encodeURIComponent(id), { method: "DELETE" }, session);
  }
};
