/**
 * Validation barrel — Zod schemas and parsers.
 *
 * Every domain ships an `<X>Validation.ts` colocated with its service.
 * Routes import the schemas; services accept `unknown` and call
 * `schema.safeParse(input)` to keep validation errors uniform.
 */

export * from "@/validation/commonValidation";
export * from "@/validation/parseValidation";
export * from "@/validation/patientValidation";
export * from "@/validation/employeeValidation";
export * from "@/validation/inquiryValidation";
export * from "@/validation/dutyValidation";
export * from "@/validation/billingValidation";
export * from "@/validation/billingDto";
export * from "@/validation/payoutValidation";
export * from "@/validation/payoutDto";
export * from "@/validation/attendanceValidation";
export * from "@/validation/whatsappValidation";
export * from "@/validation/aiValidation";
export * from "@/validation/doctorValidation";
export * from "@/validation/vendorValidation";
export * from "@/validation/userValidation";
export * from "@/validation/settingsValidation";
