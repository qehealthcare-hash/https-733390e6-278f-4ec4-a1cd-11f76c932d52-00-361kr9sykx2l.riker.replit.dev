/**
 * Typed CRM API clients — frontend service layer over `/api/v1`.
 */
export type { ApiSession, ApiRequestOptions, ClientListParams } from "@/lib/clients/types";
export { toQueryString, withQuery } from "@/lib/clients/http";
export { patientsClient, PATIENTS_BASE } from "@/lib/clients/patientsClient";
export { employeesClient, EMPLOYEES_BASE } from "@/lib/clients/employeesClient";
export { billingsClient, BILLINGS_BASE } from "@/lib/clients/billingsClient";
export { settingsClient, SETTINGS_BASE } from "@/lib/clients/settingsClient";
export { auditsClient, AUDITS_BASE } from "@/lib/clients/auditsClient";
export { authClient } from "@/lib/clients/authClient";
export { lookupsClient } from "@/lib/clients/lookupsClient";
export { dutiesClient, DUTIES_BASE } from "@/lib/clients/dutiesClient";
export { reportsClient, REPORTS_BASE } from "@/lib/clients/reportsClient";
export { usersClient, rolesClient, USERS_BASE, ROLES_BASE } from "@/lib/clients/usersClient";
export { vendorsClient, VENDORS_BASE } from "@/lib/clients/vendorsClient";
export { doctorsClient, DOCTORS_BASE } from "@/lib/clients/doctorsClient";
export { inquiriesClient, INQUIRIES_BASE } from "@/lib/clients/inquiriesClient";
export { payoutsClient, PAYOUTS_BASE } from "@/lib/clients/payoutsClient";
export { attendanceClient, ATTENDANCE_BASE } from "@/lib/clients/attendanceClient";
