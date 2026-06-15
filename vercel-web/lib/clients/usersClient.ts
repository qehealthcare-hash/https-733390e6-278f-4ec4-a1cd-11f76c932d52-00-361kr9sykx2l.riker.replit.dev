import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  roleDeleteResultDtoSchema,
  roleListResponseDtoSchema,
  roleRowDtoSchema,
  userDeactivateResultDtoSchema,
  userListResponseDtoSchema,
  userRowDtoSchema
} from "@/validation/userDto";

export const USERS_BASE = "/users";
export const ROLES_BASE = "/roles";

export const usersClient = {
  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(USERS_BASE, params), null, session, userListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(USERS_BASE + "/" + encodeURIComponent(id), null, session, userRowDtoSchema);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestValidatedWithOfflineFallback(
        USERS_BASE + "/" + encodeURIComponent(id),
        { method: "PATCH", body },
        session,
        userRowDtoSchema
      );
    }
    return requestValidatedWithOfflineFallback(USERS_BASE, { method: "POST", body }, session, userRowDtoSchema);
  },

  deactivate(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      USERS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE" },
      session,
      userDeactivateResultDtoSchema
    );
  }
};

export const rolesClient = {
  list(session: ApiSession) {
    return requestValidated(ROLES_BASE, null, session, roleListResponseDtoSchema);
  },

  save(session: ApiSession, id: string | undefined, body: Record<string, unknown>) {
    if (id) {
      return requestValidatedWithOfflineFallback(
        ROLES_BASE + "/" + encodeURIComponent(id),
        { method: "PATCH", body },
        session,
        roleRowDtoSchema
      );
    }
    return requestValidatedWithOfflineFallback(ROLES_BASE, { method: "POST", body }, session, roleRowDtoSchema);
  },

  remove(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(
      ROLES_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE" },
      session,
      roleDeleteResultDtoSchema
    );
  }
};
