import { request } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";

export const lookupsClient = {
  employees(session: ApiSession) {
    return request("/lookups/employees", null, session);
  },

  patients(session: ApiSession, q?: string) {
    const path = q ? "/lookups/patients?q=" + encodeURIComponent(String(q)) : "/lookups/patients";
    return request(path, null, session);
  },

  services(session: ApiSession) {
    return request("/lookups/services", null, session);
  },

  roles(session: ApiSession) {
    return request("/lookups/roles", null, session);
  }
};
