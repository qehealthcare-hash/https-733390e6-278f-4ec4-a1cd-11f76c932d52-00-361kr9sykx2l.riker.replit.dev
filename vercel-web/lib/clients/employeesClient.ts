import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";
import {
  employeeDeleteResultDtoSchema,
  employeeDetailDtoSchema,
  employeeLinkCountsDtoSchema,
  employeeListResponseDtoSchema,
} from "@/validation/employeeDto";

export const EMPLOYEES_BASE = "/employees";

export const employeesClient = {
  basePath: EMPLOYEES_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return requestValidated(withQuery(EMPLOYEES_BASE, params), null, session, employeeListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(EMPLOYEES_BASE + "/" + encodeURIComponent(id), null, session, employeeDetailDtoSchema);
  },

  links(session: ApiSession, id: string) {
    return requestValidated(
      EMPLOYEES_BASE + "/" + encodeURIComponent(id) + "/links",
      null,
      session,
      employeeLinkCountsDtoSchema
    );
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) {
      return requestValidatedWithOfflineFallback(
        EMPLOYEES_BASE + "/" + encodeURIComponent(id),
        { method: "PUT", body },
        session,
        employeeDetailDtoSchema
      );
    }
    return requestValidatedWithOfflineFallback(EMPLOYEES_BASE, { method: "POST", body }, session, employeeDetailDtoSchema);
  },

  setStatus(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      EMPLOYEES_BASE + "/" + encodeURIComponent(id) + "/status",
      { method: "POST", body },
      session,
      employeeDetailDtoSchema
    );
  },

  remove(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      EMPLOYEES_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || {} },
      session,
      employeeDeleteResultDtoSchema
    );
  }
};
