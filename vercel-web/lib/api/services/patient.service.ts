import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { idSchema, phoneSchema } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_patients";

export const patientSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    full_name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    dob: z.string().optional().default(""),
    age: z.string().optional().default(""),
    gender: z.string().optional().default(""),
    addr: z.string().optional().default(""),
    address: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    pincode: z.string().optional(),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    relname2: z.string().optional().default(""),
    relphone2: z.string().optional().default(""),
    relname3: z.string().optional().default(""),
    relphone3: z.string().optional().default(""),
    email: z.string().email().optional(),
    status: z.enum(["Active", "Closed", "On Hold"]).optional().default("Active"),
    shift: z.string().optional().default(""),
    shift_type: z.enum(["DAY", "NIGHT", "24H", "FULL"]).optional(),
    caretaker_id: z.string().optional().default(""),
    assigned_staff_id: z.string().optional(),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.full_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["name"] });
    }
    if (!v.phone && !v.mobile) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
    }
  })
  .transform((v) => ({
    ...v,
    name: v.name || v.full_name || "",
    phone: (v.phone || v.mobile || "").replace(/[^0-9+]/g, ""),
    addr: v.addr || v.address || "",
    pin: v.pin || v.pincode || "",
    shift: v.shift || v.shift_type || "",
    caretaker_id: v.caretaker_id || v.assigned_staff_id || ""
  }));

export type PatientInput = z.infer<typeof patientSchema>;

function toRow(input: PatientInput) {
  return {
    name: input.name,
    phone: input.phone,
    dob: input.dob,
    gender: input.gender,
    addr: input.addr,
    area: input.area,
    city: input.city,
    pin: input.pin,
    relname: input.relname,
    relphone: input.relphone,
    relname2: input.relname2,
    relphone2: input.relphone2,
    relname3: input.relname3,
    relphone3: input.relphone3,
    email: input.email || "",
    status: input.status,
    shift: input.shift,
    caretaker_id: input.caretaker_id || null,
    docs: input.docs ?? undefined
  };
}

function toApi(row: Record<string, any>) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name || "",
    full_name: row.name || "",
    phone: row.phone || "",
    mobile: row.phone || "",
    dob: row.dob || "",
    age: row.age || "",
    gender: row.gender || "",
    addr: row.addr || "",
    address: row.addr || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    pin: row.pin || "",
    pincode: row.pin || "",
    relname: row.relname || "",
    relphone: row.relphone || "",
    email: row.email || "",
    status: row.status || "Active",
    shift: row.shift || "",
    shift_type: row.shift || "",
    caretaker_id: row.caretaker_id || "",
    assigned_staff_id: row.caretaker_id || "",
    docs: row.docs || [],
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

async function findDuplicate(phone: string, excludeId?: string) {
  const normalized = (phone || "").replace(/[^0-9+]/g, "");
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, name, phone, status")
    .ilike("phone", `%${normalized.slice(-8)}%`);
  if (error) throw error;
  return (data || []).find((r) => r.id !== excludeId && (r.status || "Active") === "Active") || null;
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
