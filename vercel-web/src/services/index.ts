export { employeeService } from "@/services/employeeService";
export type { EmployeeListOptions, EmployeeServiceContext } from "@/services/employeeService";

export { dutyService } from "@/services/dutyService";
export type { DutyServiceContext, ActorLike as DutyActorLike } from "@/services/dutyService";

export { attendanceService } from "@/services/attendanceService";
export type { AttendanceServiceContext, ActorLike as AttendanceActorLike } from "@/services/attendanceService";

export { billingService } from "@/services/billingService";
export type { BillingServiceContext, ActorLike as BillingActorLike, BillingWithTotals } from "@/services/billingService";

export { payoutService } from "@/services/payoutService";
export type { PayoutServiceContext, ActorLike as PayoutActorLike } from "@/services/payoutService";

export { reportService } from "@/services/reportService";
export type { ReportServiceContext, ActorLike as ReportActorLike } from "@/services/reportService";

export { inquiryService } from "@/services/inquiryService";
export type { InquiryServiceContext, ActorLike as InquiryActorLike } from "@/services/inquiryService";

export { patientService } from "@/services/patientService";
export type { PatientServiceContext, ActorLike as PatientActorLike } from "@/services/patientService";
