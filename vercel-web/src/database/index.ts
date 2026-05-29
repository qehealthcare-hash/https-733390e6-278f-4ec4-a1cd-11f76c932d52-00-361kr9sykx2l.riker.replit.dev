/**
 * Database layer barrel — import repositories from `@/database`.
 *
 * Every repository wraps Supabase access in `ApiResult<T>` via
 * `baseRepository` / `supabaseClient`. Services orchestrate them;
 * routes and business code never import repositories or Supabase
 * clients directly.
 */

export * from "@/database/types";
export * from "@/database/supabaseClient";
export { supabaseAdmin, supabaseAsUser, dbFor } from "@/database/clients";
export * from "@/database/baseRepository";

export { patientRepository } from "@/database/patientRepository";
export { employeeRepository } from "@/database/employeeRepository";
export { inquiryRepository } from "@/database/inquiryRepository";
export { dutyRepository } from "@/database/dutyRepository";
export { billingRepository } from "@/database/billingRepository";
export { payoutRepository } from "@/database/payoutRepository";
export { dutyDayRepository } from "@/database/dutyDayRepository";
export { attendanceRepository } from "@/database/attendanceRepository";
export { reportRepository } from "@/database/reportRepository";
export { auditRepository } from "@/database/auditRepository";

export { doctorRepository } from "@/database/doctorRepository";
export { vendorRepository } from "@/database/vendorRepository";
export { settingsRepository } from "@/database/settingsRepository";
export { lookupRepository } from "@/database/lookupRepository";
export { userRepository, roleRepository } from "@/database/userRepository";

export { aiRepository } from "@/database/aiRepository";
export { whatsappRepository } from "@/database/whatsappRepository";
export { storageRepository } from "@/database/storageRepository";
export { healthRepository } from "@/database/healthRepository";
export { idempotencyRepository } from "@/database/idempotencyRepository";
