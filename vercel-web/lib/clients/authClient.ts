import { request } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";

export const authClient = {
  me(session: ApiSession) {
    return request("/auth/me", null, session);
  }
};
