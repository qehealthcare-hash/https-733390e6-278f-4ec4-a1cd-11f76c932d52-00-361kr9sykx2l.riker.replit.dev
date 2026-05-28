import { request } from "@/lib/api-client";

export const lookupsClient = {
  /** Active employee rows for assignment dropdowns. */
  employees(session) {
    return request("/lookups/employees", null, session);
  },

  /** Patient typeahead (optional search term). */
  patients(session, q) {
    var path = q ? "/lookups/patients?q=" + encodeURIComponent(String(q)) : "/lookups/patients";
    return request(path, null, session);
  }
};
