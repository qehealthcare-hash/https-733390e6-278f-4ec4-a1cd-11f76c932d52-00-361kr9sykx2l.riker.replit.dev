/**
 * Typed CRM API clients — frontend service layer over `/api/v1`.
 *
 * Usage:
 *   import { patientsClient, lookupsClient } from "@/lib/clients";
 *   await patientsClient.get(session, id);
 *
 * Do not call `request("/patients/...")` directly from pages; add a method here
 * when a new endpoint is needed so paths stay centralized.
 */
export { toQueryString, withQuery } from "@/lib/clients/http";
export { patientsClient, PATIENTS_BASE } from "@/lib/clients/patientsClient";
export { lookupsClient } from "@/lib/clients/lookupsClient";
