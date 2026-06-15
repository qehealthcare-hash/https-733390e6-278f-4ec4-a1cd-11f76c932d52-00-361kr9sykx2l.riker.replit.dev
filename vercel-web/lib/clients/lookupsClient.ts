import { requestValidated } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import {
  employeeLookupListDtoSchema,
  patientLookupListDtoSchema,
  roleLookupListDtoSchema,
  serviceLookupListDtoSchema,
} from "@/validation/lookupDto";

export const lookupsClient = {
  employees(session: ApiSession) {
    return requestValidated("/lookups/employees", null, session, employeeLookupListDtoSchema);
  },

  patients(session: ApiSession, q?: string) {
    const path = q ? "/lookups/patients?q=" + encodeURIComponent(String(q)) : "/lookups/patients";
    return requestValidated(path, null, session, patientLookupListDtoSchema);
  },

  services(session: ApiSession) {
    return requestValidated("/lookups/services", null, session, serviceLookupListDtoSchema);
  },

  roles(session: ApiSession) {
    return requestValidated("/lookups/roles", null, session, roleLookupListDtoSchema);
  }
};
