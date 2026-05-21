import { supabaseAdmin } from "../supabase";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import type { ActorContext } from "../auth";
import { patientSchema, type PatientInput } from "@/validation/patientValidation";
import { patientToRow as toRow, patientToApi as toApi, findActivePatientDuplicate } from "@/business/patientRules";
import { phoneSuffix } from "@/business/phoneRules";

export { patientSchema, patientAssignSchema, type PatientInput, type PatientAssignInput } from "@/validation/patientValidation";

const TABLE = "hh_patients";

async function findDuplicate(phone: string, excludeId?: string) {
  const suffix = phoneSuffix(phone);
  if (!suffix) return null;
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, name, phone, status")
    .ilike("phone", `%${suffix}%`);
  if (error) throw error;
  return findActivePatientDuplicate(data || [], phone, excludeId);
}

export const patientService = {
  async list(opts: { limit: number; offset: number; q: string; status?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.q) {
      query = query.or(
        ["name", "phone", "area", "city", "addr"]
          .map((c) => `${c}.ilike.%${opts.q}%`)
          .join(",")
      );
    }
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: (data || []).map(toApi), total: count ?? data?.length ?? 0 };
  },

  async getById(id: string) {
    const { data, error } = await supabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Patient");
    return toApi(data);
  },

  async create(input: PatientInput, actor: ActorContext) {
    if (input.phone) {
      const dup = await findDuplicate(input.phone);
      if (dup) throw conflict("Active patient already exists for this mobile", { existingId: dup.id });
    }
    const id = input.id || newId.patient();
    const row = toRow(input);
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .insert({
        ...row,
        id,
        created: new Date().toISOString(),
        created_by: actor.email,
        updated_by: actor.email
      })
      .select("*")
      .single();
    if (error) throw error;
    return toApi(data);
  },

  async update(id: string, input: PatientInput, actor: ActorContext) {
    const existing = await this.getById(id);
    if (input.phone && input.phone !== existing.phone) {
      const dup = await findDuplicate(input.phone, id);
      if (dup) throw conflict("Another active patient uses this mobile", { existingId: dup.id });
    }
    const row = toRow(input);
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ ...row, updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return toApi(data);
  },

  async remove(id: string, actor: ActorContext) {
    const existing = await this.getById(id);
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ status: "Closed", updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return toApi(data);
  },

  async assignCaretaker(id: string, caretakerId: string, shift: string, actor: ActorContext) {
    const existing = await this.getById(id);
    const employee = await supabaseAdmin()
      .from("hh_employees")
      .select("id, fn, ln")
      .eq("id", caretakerId)
      .maybeSingle();
    if (employee.error) throw employee.error;
    if (!employee.data) throw notFound("Caretaker");
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ caretaker_id: caretakerId, shift, updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, {
      module: "patient",
      entityId: id,
      action: "update",
      before: existing,
      after: data,
      stamp: `Assigned caretaker ${caretakerId} (${shift})`
    });
    return toApi(data);
  },

  async history(id: string) {
    const admin = supabaseAdmin();
    const [billings, receipts, duties, audits, patient] = await Promise.all([
      admin.from("hh_billings").select("*").eq("patient_id", id).order("created_at", { ascending: false }),
      admin.from("hh_receipts").select("*").order("created_at", { ascending: false }),
      admin.from("hh_duties").select("*").eq("patient_id", id).order("start_at", { ascending: false }),
      admin.from("hh_audit_logs").select("*").eq("module", "patient").eq("entity_id", id).order("created_at", { ascending: false }).limit(100),
      this.getById(id)
    ]);
    const billingIds = new Set((billings.data || []).map((b) => b.id));
    return {
      patient,
      billings: billings.data || [],
      receipts: (receipts.data || []).filter((r) => billingIds.has(r.billing_id)),
      duties: duties.data || [],
      audits: audits.data || []
    };
  }
};
