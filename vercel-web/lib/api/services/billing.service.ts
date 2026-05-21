import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { idSchema, moneySchema } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_billings";

/** Default shift rate hints — override via DB once you store rate plans per service. */
export type ShiftRates = { DAY: number; NIGHT: number; "24H": number; FULL: number };
export const DEFAULT_SHIFT_RATES: ShiftRates = { DAY: 700, NIGHT: 900, "24H": 1500, FULL: 1500 };

export function amountForShift(shift: string, overrides?: Partial<ShiftRates>): number {
  const rates: ShiftRates = { ...DEFAULT_SHIFT_RATES, ...(overrides || {}) };
  const key = (shift || "DAY").toUpperCase() as keyof ShiftRates;
  return rates[key] ?? rates.DAY;
}

export const billingSchema = z.object({
  id: idSchema.optional(),
  patient_id: idSchema,
  status: z.enum(["Active", "Closed", "Cancelled"]).default("Active"),
  sec_dep: moneySchema.optional().default(0)
});

export const receiptSchema = z.object({
  id: idSchema.optional(),
  billing_id: idSchema,
  date: z.string().optional().default(""),
  type: z.string().optional().default(""),
  amount: moneySchema,
  method: z.string().optional().default(""),
  ref: z.string().optional().default(""),
  remarks: z.string().optional().default("")
});

export const generateFromDutySchema = z.object({
  duty_id: idSchema,
  service_name: z.string().default("Caretaker"),
  rate_overrides: z
    .object({ DAY: moneySchema.optional(), NIGHT: moneySchema.optional(), "24H": moneySchema.optional(), FULL: moneySchema.optional() })
    .optional()
});

export type BillingInput = z.infer<typeof billingSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;

async function ensureActiveBilling(patientId: string, actor: ActorContext) {
  const existing = await supabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "Active")
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const id = newId.billing();
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .insert({
      id,
      patient_id: patientId,
      status: "Active",
      sec_dep: 0,
      created: new Date().toISOString(),
      created_by: actor.email,
      updated_by: actor.email
    })
    .select("*")
    .single();
  if (error) {
    if ((error.message || "").toLowerCase().includes("uq_hh_billings_patient_active")) {
      const retry = await supabaseAdmin().from(TABLE).select("*").eq("patient_id", patientId).eq("status", "Active").maybeSingle();
      if (retry.data) return retry.data;
    }
    throw error;
  }
  return data;
}

export const billingService = {
  async listByPatient(patientId: string) {
    const admin = supabaseAdmin();
    const [bill, receipts, svc] = await Promise.all([
      admin.from(TABLE).select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
      admin.from("hh_receipts").select("*").order("date", { ascending: false }),
      admin.from("hh_svc_entries").select("*").order("date", { ascending: false })
    ]);
    if (bill.error) throw bill.error;
    return {
      billings: bill.data || [],
      receipts: (receipts.data || []).filter((r) => (bill.data || []).some((b) => b.id === r.billing_id)),
      services: (svc.data || []).filter((s) => (bill.data || []).some((b) => b.id === s.billing_id))
    };
  },

  async create(input: BillingInput, actor: ActorContext) {
    return ensureActiveBilling(input.patient_id, actor);
  },

  async updateStatus(id: string, status: BillingInput["status"], actor: ActorContext) {
    const { data: existing, error: getErr } = await supabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing) throw notFound("Billing");
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ status, updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "billing", entityId: id, action: "update", before: existing, after: data, stamp: `Status -> ${status}` });
    return data;
  },

  async generateFromDuty(input: z.infer<typeof generateFromDutySchema>, actor: ActorContext) {
    const admin = supabaseAdmin();
    const { data: duty, error: dErr } = await admin.from("hh_duties").select("*").eq("id", input.duty_id).maybeSingle();
    if (dErr) throw dErr;
    if (!duty) throw notFound("Duty");
    if (!duty.patient_id) throw badRequest("Duty has no patient");
    if (duty.billing_id) {
      const { data: existing } = await admin.from("hh_svc_entries").select("*").eq("billing_id", duty.billing_id).eq("remarks", `duty:${duty.id}`).maybeSingle();
      if (existing) {
        return { billing_id: duty.billing_id, svc_entry: existing, duplicate: true };
      }
    }
    const billing = await ensureActiveBilling(duty.patient_id, actor);
    const amount = amountForShift(duty.shift_type, input.rate_overrides);
    const svcKey = `${duty.patient_id}|${input.service_name}`;
    const dupCheck = await admin
      .from("hh_svc_entries")
      .select("id")
      .eq("billing_id", billing.id)
      .eq("date", duty.start_at.slice(0, 10))
      .eq("service_name", input.service_name)
      .maybeSingle();
    if (dupCheck.data) {
      throw conflict("A bill already exists for this patient + service + date", { existing: dupCheck.data });
    }
    const { data: svc, error: sErr } = await admin
      .from("hh_svc_entries")
      .insert({
        svc_key: svcKey,
        billing_id: billing.id,
        service_name: input.service_name,
        partner: duty.employee_id || "",
        date: duty.start_at.slice(0, 10),
        freq: duty.shift_type,
        amt: amount,
        count: 1,
        disc: 0,
        total: amount,
        remarks: `duty:${duty.id}`
      })
      .select("*")
      .single();
    if (sErr) throw sErr;
    await admin.from("hh_duties").update({ billing_id: billing.id, updated_by: actor.email }).eq("id", duty.id);
    await audit(actor, {
      module: "billing",
      entityId: billing.id,
      action: "create",
      after: svc,
      stamp: `Bill from duty ${duty.id}, ${duty.shift_type} ₹${amount}`
    });
    return { billing_id: billing.id, svc_entry: svc, duplicate: false };
  },

  async recordPayment(input: ReceiptInput, actor: ActorContext) {
    const admin = supabaseAdmin();
    if (input.id) {
      const exists = await admin.from("hh_receipts").select("id").eq("id", input.id).maybeSingle();
      if (exists.data) throw conflict("Receipt id already exists", { existingId: input.id });
    }
    const id = input.id || newId.receipt();
    const { data, error } = await admin.rpc("hominal_save_receipt", {
      p_receipt: { ...input, id, created_by: actor.email }
    });
    if (error) throw error;
    await audit(actor, { module: "receipt", entityId: id, action: "create", after: data });
    return data;
  },

  async invoicePayload(billingId: string) {
    const admin = supabaseAdmin();
    const [billing, receipts, services] = await Promise.all([
      admin.from(TABLE).select("*").eq("id", billingId).maybeSingle(),
      admin.from("hh_receipts").select("*").eq("billing_id", billingId).order("date"),
      admin.from("hh_svc_entries").select("*").eq("billing_id", billingId).order("date")
    ]);
    if (billing.error) throw billing.error;
    if (!billing.data) throw notFound("Billing");
    const patient = await admin.from("hh_patients").select("*").eq("id", billing.data.patient_id).maybeSingle();
    const totals = {
      services: (services.data || []).reduce((sum, r) => sum + Number(r.total || 0), 0),
      receipts: (receipts.data || []).reduce((sum, r) => sum + Number(r.amount || 0), 0),
      sec_dep: Number(billing.data.sec_dep || 0)
    };
    return {
      billing: billing.data,
      patient: patient.data || null,
      services: services.data || [],
      receipts: receipts.data || [],
      totals: { ...totals, outstanding: Math.max(0, totals.services - totals.receipts) }
    };
  }
};
