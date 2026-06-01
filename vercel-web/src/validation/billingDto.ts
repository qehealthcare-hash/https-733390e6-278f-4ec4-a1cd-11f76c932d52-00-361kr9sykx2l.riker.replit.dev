import { z } from "zod";
import { idSchema, moneySchema, monthPeriodSchema } from "@/validation/commonValidation";
import { BILLING_STATUSES } from "@/validation/billingValidation";

/**
 * Output / read-model contracts for the billing module.
 *
 * These schemas describe what the API returns after business rules run.
 * Routes serialize `BillingSummaryDTO`; the billings page should treat
 * this shape as authoritative (no client-side recomputation).
 */

export const billingPaidStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID"]);
export type BillingPaidStatusDto = z.infer<typeof billingPaidStatusSchema>;

export const invoicePaidStatusSchema = z.enum([
  "UNPAID",
  "PARTIAL",
  "PAID",
  "CANCELLED"
]);
export type InvoicePaidStatusDto = z.infer<typeof invoicePaidStatusSchema>;

export const invoiceKindSchema = z.enum(["MONTHLY", "FINAL", "MANUAL"]);
export type InvoiceKindDto = z.infer<typeof invoiceKindSchema>;

/** Server-computed bill-level totals — never recompute in the UI. */
export const billingTotalsDtoSchema = z.object({
  services: moneySchema,
  billed: moneySchema,
  receipts: moneySchema,
  sec_dep: moneySchema,
  discount: moneySchema,
  advance: moneySchema,
  outstanding: moneySchema
});
export type BillingTotalsDto = z.infer<typeof billingTotalsDtoSchema>;

/** Minimal billing header returned inside a bundle. */
export const billingRowDtoSchema = z.object({
  id: idSchema,
  patient_id: idSchema,
  status: z.enum(BILLING_STATUSES),
  paid_status: billingPaidStatusSchema.optional(),
  sec_dep: moneySchema.optional(),
  notes: z.string().optional(),
  closed_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});
export type BillingRowDto = z.infer<typeof billingRowDtoSchema>;

export const patientSnapshotDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  area: z.string(),
  city: z.string(),
  pincode: z.string()
});
export type PatientSnapshotDto = z.infer<typeof patientSnapshotDtoSchema>;

/** Persisted invoice row (subset of hh_invoices columns the UI prints). */
export const invoiceRowDtoSchema = z.object({
  id: idSchema,
  billing_id: idSchema,
  invoice_no: z.string().optional(),
  kind: invoiceKindSchema.optional(),
  status: z.string().optional(),
  period: monthPeriodSchema.nullable().optional(),
  amount: moneySchema.optional(),
  from_date: z.string().nullable().optional(),
  to_date: z.string().nullable().optional(),
  notes: z.string().optional(),
  created_at: z.string().optional()
});
export type InvoiceRowDto = z.infer<typeof invoiceRowDtoSchema>;

/** Invoice row + server-derived settlement fields for the invoice table. */
export const invoiceSummaryDtoSchema = z.object({
  invoice: invoiceRowDtoSchema.passthrough(),
  amount: moneySchema,
  received: moneySchema,
  outstanding: moneySchema,
  status: invoicePaidStatusSchema
});
export type InvoiceSummaryDto = z.infer<typeof invoiceSummaryDtoSchema>;

export const receiptRowDtoSchema = z.object({
  id: idSchema,
  billing_id: idSchema,
  invoice_id: idSchema.nullable().optional(),
  patient_id: z.string().optional(),
  date: z.string().optional(),
  type: z.string().optional(),
  amount: moneySchema,
  method: z.string().optional(),
  ref: z.string().optional(),
  remarks: z.string().optional(),
  receipt_no: z.string().optional()
});
export type ReceiptRowDto = z.infer<typeof receiptRowDtoSchema>;

/**
 * UI action flags — computed only in the business layer.
 * `blockReasons` maps action keys to human-readable messages when false.
 */
export const billingPermissionsDtoSchema = z.object({
  canEdit: z.boolean(),
  canReceive: z.boolean(),
  canGenerateFinal: z.boolean(),
  canClose: z.boolean(),
  canReopen: z.boolean(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type BillingPermissionsDto = z.infer<typeof billingPermissionsDtoSchema>;

export const billingPeriodDtoSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  months: z.array(monthPeriodSchema)
});

/** Full billing workspace payload for GET /billings/:id and related flows. */
export const billingSummaryDtoSchema = z.object({
  billing: billingRowDtoSchema.passthrough(),
  services: z.array(z.record(z.unknown())),
  receipts: z.array(receiptRowDtoSchema.passthrough()),
  invoices: z.array(invoiceSummaryDtoSchema),
  totals: billingTotalsDtoSchema,
  period: billingPeriodDtoSchema,
  patient: patientSnapshotDtoSchema.nullable(),
  permissions: billingPermissionsDtoSchema
});
export type BillingSummaryDto = z.infer<typeof billingSummaryDtoSchema>;

/** Parse and validate a bundle before it leaves the service (contract test hook). */
export function parseBillingSummaryDto(data: unknown) {
  return billingSummaryDtoSchema.safeParse(data);
}
