/**
 * Service-layer barrel.
 *
 * Every service returns `ApiResult<T>`. Routes import services from this
 * barrel and never reach into individual `<X>Service.ts` files when a
 * generic surface (e.g. for type-only consumers) will do.
 *
 * For the canonical actor / context types every service accepts, see
 * `@/types/serviceActor` (re-exported below for convenience).
 */

export type { ServiceActor, ServiceContext } from "@/types/serviceActor";

/* --------------------------- Domain CRUD services ------------------------- */

export { patientService } from "@/services/patientService";
export type { PatientServiceContext } from "@/services/patientService";

export { employeeService } from "@/services/employeeService";
export type { EmployeeListOptions, EmployeeServiceContext } from "@/services/employeeService";

export { dutyService } from "@/services/dutyService";
export type { DutyServiceContext } from "@/services/dutyService";

export { dutyDiaryService } from "@/services/dutyDiaryService";

export { attendanceService } from "@/services/attendanceService";
export type { AttendanceServiceContext } from "@/services/attendanceService";

export { billingService } from "@/services/billingService";
export type { BillingServiceContext, BillingWithTotals } from "@/services/billingService";

export { payoutService } from "@/services/payoutService";
export type { PayoutServiceContext } from "@/services/payoutService";

export { reportService } from "@/services/reportService";
export type { ReportServiceContext } from "@/services/reportService";

export { inquiryService } from "@/services/inquiryService";
export type { InquiryServiceContext } from "@/services/inquiryService";

export { doctorService } from "@/services/doctorService";
export type { DoctorListOptions, DoctorRecord } from "@/services/doctorService";

export { vendorService } from "@/services/vendorService";
export type { VendorListOptions } from "@/services/vendorService";

export { settingsService } from "@/services/settingsService";

export { lookupService } from "@/services/lookupService";

export { userService } from "@/services/userService";

/* --------------------------- Cross-cutting services ----------------------- */

export { auditService } from "@/services/auditService";
export type { AuditServiceContext } from "@/services/auditService";

export {
  writeMutationAudit,
  finalizeWithAudit,
  isAuditDisabled,
  type MutationAuditPayload
} from "@/services/mutationAudit";

/* --------------------------- Integrations --------------------------------- */

export { aiService } from "@/services/aiService";
export type { AskResult } from "@/services/aiService";

export { whatsappService } from "@/services/whatsappService";
export type { SendResult, WhatsappListOptions } from "@/services/whatsappService";

export { storageService } from "@/services/storageService";

export { healthService } from "@/services/healthService";
export type { HealthSnapshot } from "@/services/healthService";
