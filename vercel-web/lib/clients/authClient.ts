import { requestValidated } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import {
  actorMeDtoSchema,
  loginSessionDtoSchema,
  logoutResultDtoSchema,
  refreshSessionDtoSchema
} from "@/validation/authDto";

export type LogoutScope = "global" | "local" | "others";

export const authClient = {
  me(session: ApiSession) {
    return requestValidated("/auth/me", null, session, actorMeDtoSchema);
  },

  login(identifier: string, password: string) {
    return requestValidated(
      "/auth/login",
      {
        method: "POST",
        body: { identifier, password },
        credentials: "include"
      },
      null,
      loginSessionDtoSchema
    );
  },

  refresh() {
    return requestValidated(
      "/auth/refresh",
      { method: "POST", credentials: "include" },
      null,
      refreshSessionDtoSchema
    );
  },

  logout(session: ApiSession, scope: LogoutScope = "global") {
    return requestValidated(
      "/auth/logout",
      { method: "POST", body: { scope }, credentials: "include" },
      session,
      logoutResultDtoSchema
    );
  }
};
