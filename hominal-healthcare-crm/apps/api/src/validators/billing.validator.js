import { z } from "zod";

export const invoiceSchema = z.object({
  patient_id: z.string().min(1),
  service_month: z.string(),
  invoice_type: z.enum(["PROVISIONAL", "FINAL"]).default("PROVISIONAL"),
  security_deposit: z.coerce.number().min(0).default(0),
  items: z
    .array(
      z.object({
        service_name: z.string().min(2),
        assigned_staff_id: z.string().uuid().nullable().optional(),
        duration_label: z.string().min(1),
        total_days: z.coerce.number().min(0),
        total_people: z.coerce.number().min(1),
        rate_per_day: z.coerce.number().min(0),
        absent_days: z.coerce.number().min(0).default(0),
        service_start_date: z.string().optional(),
        service_dates: z.array(z.string()).optional().default([])
      })
    )
    .min(1),
  status: z.enum(["OPEN", "PAUSED", "CLOSED"]).default("OPEN"),
  close_reason: z.string().nullable().optional()
});

export const receiptSchema = z.object({
  invoice_id: z.string().uuid(),
  patient_id: z.string().uuid().optional(),
  receipt_no: z.string().optional().default(""),
  transaction_type: z.string().optional().default("PAYMENT"),
  service_name: z.string().optional().default(""),
  bill_mode: z.enum(["MONTHLY", "CUSTOM"]).optional().default("MONTHLY"),
  from_date: z.string().optional().default(""),
  to_date: z.string().optional().default(""),
  paid_days: z.coerce.number().min(0).optional().default(0),
  paid_service_dates: z.array(z.string()).optional().default([]),
  amount: z.coerce.number().min(0.01),
  payment_mode: z.enum(["CASH", "UPI", "BANK"]),
  received_on: z.string(),
  invoice_reference: z.string().optional().default(""),
  note: z.string().optional().default("")
});
