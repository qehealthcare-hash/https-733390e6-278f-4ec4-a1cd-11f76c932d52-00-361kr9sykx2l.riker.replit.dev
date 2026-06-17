import { z } from "zod";
import {
  idSchema,
  moneySchema,
  monthPeriodSchema,
  signedMoneySchema
} from "@/validation/commonValidation";
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
  // Net of receipts; can be negative when a bill has refund/reversal receipts.
  receipts: signedMoneySchema,
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
  // Net receipts applied to the invoice; negative when reversals exceed receipts.
  received: signedMoneySchema,
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
  // Refund / reversal receipts are stored as negative amounts.
  amount: signedMoneySchema,
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

/** List row — billing header plus server-enriched display fields. */
export const billingListRowDtoSchema = billingRowDtoSchema
  .extend({
    patient_name: z.string().optional(),
    patient_phone: z.string().optional(),
    totals: billingTotalsDtoSchema.optional()
  })
  .passthrough();
export type BillingListRowDto = z.infer<typeof billingListRowDtoSchema>;

export const billingListResponseDtoSchema = z.object({
  rows: z.array(billingListRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type BillingListResponseDto = z.infer<typeof billingListResponseDtoSchema>;

/** GET /billings?patient_id= — patient billing history bundle. */
export const billingPatientHistoryDtoSchema = z.object({
  billings: z.array(billingRowDtoSchema.passthrough()),
  receipts: z.array(receiptRowDtoSchema.passthrough()),
  services: z.array(z.record(z.unknown())),
  invoices: z.array(invoiceSummaryDtoSchema),
  totalsByBilling: z.record(z.string(), billingTotalsDtoSchema)
});
export type BillingPatientHistoryDto = z.infer<typeof billingPatientHistoryDtoSchema>;

export const billingListOrPatientHistoryDtoSchema = z.union([
  billingListResponseDtoSchema,
  billingPatientHistoryDtoSchema
]);

export const receiptListDtoSchema = z.array(receiptRowDtoSchema.passthrough());
export const receiptOrNullDtoSchema = receiptRowDtoSchema.nullable();
export const invoiceSummaryListDtoSchema = z.array(invoiceSummaryDtoSchema);

export const generateInvoiceResultDtoSchema = z.object({
  invoice: invoiceRowDtoSchema.passthrough(),
  lines: z.array(z.record(z.unknown())),
  duplicate: z.boolean()
});
export type GenerateInvoiceResultDto = z.infer<typeof generateInvoiceResultDtoSchema>;

export const finalInvoiceResultDtoSchema = generateInvoiceResultDtoSchema.extend({
  security_receipt_id: idSchema.nullable(),
  refund_id: idSchema.nullable(),
  refund_amount: moneySchema,
  sec_dep_applied: moneySchema,
  gross: moneySchema,
  net: moneySchema,
  noop: z.boolean().optional()
});
export type FinalInvoiceResultDto = z.infer<typeof finalInvoiceResultDtoSchema>;

export const invoiceDetailDtoSchema = z.object({
  invoice: invoiceRowDtoSchema.passthrough(),
  lines: z.array(z.record(z.unknown())),
  receipts: z.array(receiptRowDtoSchema.passthrough()),
  // Net receipts; negative when reversals exceed receipts on this invoice.
  received: signedMoneySchema,
  outstanding: moneySchema,
  status: z.union([billingPaidStatusSchema, z.literal("CANCELLED")])
});
export type InvoiceDetailDto = z.infer<typeof invoiceDetailDtoSchema>;

export const regenerateInvoiceResultDtoSchema = z.object({
  invoice: invoiceRowDtoSchema.passthrough(),
  lines: z.array(z.record(z.unknown()))
});
export type RegenerateInvoiceResultDto = z.infer<typeof regenerateInvoiceResultDtoSchema>;

export const cancelInvoiceResultDtoSchema = z.object({
  deleted: z.literal(true),
  invoice_no: z.string(),
  receipts_detached: z.number().int().nonnegative()
});
export type CancelInvoiceResultDto = z.infer<typeof cancelInvoiceResultDtoSchema>;

export const dutyLedgerSyncSummaryDtoSchema = z.object({
  billing_id: z.string(),
  processed: z.number().int().nonnegative(),
  created_svc: z.number().int().nonnegative(),
  created_payout: z.number().int().nonnegative(),
  updated_svc: z.number().int().nonnegative(),
  updated_payout: z.number().int().nonnegative(),
  deleted_svc: z.number().int().nonnegative(),
  deleted_payout: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipped_no_bill: z.number().int().nonnegative(),
  errors: z.array(z.object({ duty_id: z.string(), error: z.string() }))
});
export type DutyLedgerSyncSummaryDto = z.infer<typeof dutyLedgerSyncSummaryDtoSchema>;

export const patientDutyLedgerDtoSchema = z.object({
  patient_id: idSchema,
  period: monthPeriodSchema,
  duty_count: z.number().int().nonnegative(),
  billed: moneySchema,
  // Net receipts for the period; negative when reversals exceed receipts.
  received: signedMoneySchema,
  outstanding: moneySchema
});
export type PatientDutyLedgerDto = z.infer<typeof patientDutyLedgerDtoSchema>;

export const ledgerReplaceResultDtoSchema = z.object({
  svc_key: z.string(),
  count: z.number().int().nonnegative()
});
export type LedgerReplaceResultDto = z.infer<typeof ledgerReplaceResultDtoSchema>;

export const generateFromDutyResultDtoSchema = z.object({
  billing_id: idSchema,
  svc_entry: z.record(z.unknown()).nullable(),
  duplicate: z.boolean(),
  totals: billingTotalsDtoSchema
});
export type GenerateFromDutyResultDto = z.infer<typeof generateFromDutyResultDtoSchema>;

export const generateFromDutyRangeResultDtoSchema = z.object({
  billing_id: idSchema,
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  totals: billingTotalsDtoSchema
});
export type GenerateFromDutyRangeResultDto = z.infer<typeof generateFromDutyRangeResultDtoSchema>;

/** Parse and validate a bundle before it leaves the service (contract test hook). */
export function parseBillingSummaryDto(data: unknown) {
  return billingSummaryDtoSchema.safeParse(data);
}

/** Parse and validate a paginated billing list envelope (contract test hook). */
export function parseBillingListResponseDto(data: unknown) {
  return billingListResponseDtoSchema.safeParse(data);
}
