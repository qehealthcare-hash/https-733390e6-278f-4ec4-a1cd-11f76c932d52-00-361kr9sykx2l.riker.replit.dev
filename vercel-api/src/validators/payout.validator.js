import { z } from "zod";

const optionalRecordId = z.preprocess(function emptyToNull(value) {
  return value === "" || value === undefined ? null : value;
}, z.union([z.string().uuid(), z.string().min(2)]).nullable().optional());

export const payoutRunSchema = z.object({
  employee_id: z.string().min(1),
  payout_month: z.string().optional(),
  patient_id: optionalRecordId,
  invoice_id: optionalRecordId,
  service_name: z.string().min(2).optional(),
  payout_option: z.enum(["MONTHLY", "CUSTOM", "PARTIAL"]).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  paid_work_dates: z.array(z.string()).optional().default([]),
  paid_days: z.coerce.number().min(0).optional(),
  payable_amount: z.coerce.number().min(0).optional(),
  paid_amount: z.coerce.number().min(0).optional(),
  payment_mode: z.enum(["CASH", "UPI", "BANK"]).optional(),
  proof_file_path: z.string().nullable().optional(),
  note: z.string().optional(),
  entries: z
    .array(
      z.object({
        patient_id: z.string().min(1),
        invoice_item_id: z.string().uuid().nullable().optional(),
        service_name: z.string().min(2),
        total_days: z.coerce.number().min(0),
        rate_per_day: z.coerce.number().min(0),
        amount: z.coerce.number().min(0)
      })
    )
    .optional()
})
.superRefine(function validatePayoutShape(value, ctx) {
  if ((!value.entries || !value.entries.length) && !value.from_date && !(value.paid_work_dates || []).length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide payout entries or a payout date range"
    });
  }
});

export const payoutPaymentSchema = z.object({
  payout_id: z.string().uuid(),
  amount_paid: z.coerce.number().min(0.01),
  payment_mode: z.enum(["CASH", "UPI", "BANK"]),
  payment_date: z.string(),
  proof_file_path: z.string().nullable().optional()
});
