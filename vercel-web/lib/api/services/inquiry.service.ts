import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { conflict, notFound, badRequest } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { emailSchema, idSchema, phoneSchema } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_inquiries";

/**
 * Accept BOTH the legacy `hh_*` field names and the React UI's monorepo-style names
 * (patient_name, mobile, service_required, emergency_level, …). Map them in `toRow()`.
 */
export const inquirySchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    patient_name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    wa: z.string().trim().optional(),
    age: z.string().optional().default(""),
    gender: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    area: z.string().optional().default(""),
    address: z.string().optional().default(""),
    service: z.string().optional().default(""),
    service_required: z.string().optional(),
    source: z.string().optional().default("WHATSAPP"),
    potential: z.string().optional().default("WARM"),
    rating_emergency: z.coerce.number().min(0).max(10).optional(),
    rating_flexibility: z.coerce.number().min(0).max(10).optional(),
    rating_overall: z.coerce.number().min(0).max(10).optional(),
    emergency_level: z.coerce.number().min(0).max(10).optional(),
    flexibility_score: z.coerce.number().min(0).max(10).optional(),
    priority_score: z.coerce.number().min(0).max(10).optional(),
    status: z.string().optional().default("New"),
    assigned_to: z.string().optional().default(""),
    followup_date: z.string().optional().default(""),
    remarks: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    email: emailSchema.optional()
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.patient_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["name"] });
    }
    if (!v.phone && !v.mobile) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
    }
  })
  .transform((v) => {
    const phone = (v.phone || v.mobile || "").replace(/[^0-9+]/g, "");
    return {
      ...v,
      name: v.name || v.patient_name || "",
      phone,
      wa: (v.wa || phone || "").replace(/[^0-9+]/g, ""),
      service: v.service || v.service_required || "",
      rating_emergency: v.rating_emergency ?? v.emergency_level ?? 5,
      rating_flexibility: v.rating_flexibility ?? v.flexibility_score ?? 5,
      rating_overall: v.rating_overall ?? v.priority_score ?? 5
    };
  });

export type InquiryInput = z.infer<typeof inquirySchema>;

/** Explicit allowlist mapper — only known DB columns are forwarded. */
function toRow(input: InquiryInput) {
  return {
    name: input.name,
    phone: input.phone,
    wa: input.wa,
    age: input.age,
    gender: input.gender,
    city: input.city,
    area: input.area,
    address: input.address,
    service: input.service,
    source: input.source,
    potential: input.potential,
    rating_emergency: input.rating_emergency,
    rating_flexibility: input.rating_flexibility,
    rating_overall: input.rating_overall,
    status: input.status,
    assigned_to: input.assigned_to,
    followup_date: input.followup_date,
    notes: input.notes,
    remarks: input.remarks,
    email: input.email || ""
  };
}

async function findDuplicateByPhone(phone: string, excludeId?: string) {
  const normalized = (phone || "").replace(/[^0-9+]/g, "");
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, name, phone, status")
    .ilike("phone", `%${normalized.slice(-8)}%`)
    .not("status", "in", "(Converted,Closed,Lost)");
  if (error) throw error;
  return (data || []).find((r) => r.id !== excludeId) || null;
}

/** Map raw row to the React UI's monorepo-style shape so existing pages render correctly. */
function toApi(row: Record<string, any>) {
  if (!row) return row;
  return {
    id: row.id,
    patient_name: row.name || "",
    name: row.name || "",
    mobile: row.phone || "",
    phone: row.phone || "",
    wa: row.wa || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    address: row.address || "",
    service_required: row.service || "",
    service: row.service || "",
    source: String(row.source || "WHATSAPP").toUpperCase(),
    potential: String(row.potential || "WARM").toUpperCase(),
    emergency_level: Number(row.rating_emergency || 5),
    flexibility_score: Number(row.rating_flexibility || 5),
    priority_score: Number(row.rating_overall || 5),
    rating_emergency: Number(row.rating_emergency || 5),
    rating_flexibility: Number(row.rating_flexibility || 5),
    rating_overall: Number(row.rating_overall || 5),
    status: row.status || "New",
    assigned_to: row.assigned_to || "",
    notes: row.notes || row.remarks || "",
    remarks: row.remarks || "",
    email: row.email || "",
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

export const inquiryService = {
  async list(opts: { limit: number; offset: number; q: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.q) {
      query = query.or(
        ["name", "phone", "area", "city", "service", "status"]
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
    if (!data) throw notFound("Inquiry");
    return toApi(data);
  },

  async create(input: InquiryInput, actor: ActorContext) {
    const dup = await findDuplicateByPhone(input.phone);
    if (dup) throw conflict("Active inquiry already exists for this mobile", { existingId: dup.id });
    const id = input.id || newId.inquiry();
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

  async update(id: string, input: InquiryInput, actor: ActorContext) {
    const existing = await this.getById(id);
    if (input.phone && input.phone !== existing.phone) {
      const dup = await findDuplicateByPhone(input.phone, id);
      if (dup) throw conflict("Another active inquiry uses this mobile", { existingId: dup.id });
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
    const { error } = await supabaseAdmin().from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return { id, removed: existing };
  },

  async convertToPatient(id: string, actor: ActorContext) {
    const inquiry = await this.getById(id);
    if (!inquiry.phone) throw badRequest("Inquiry has no mobile to dedupe");

    const { data, error } = await supabaseAdmin().rpc("hh_convert_inquiry_to_patient", {
      p_inquiry_id: id
    });
    if (error) throw error;
    await audit(actor, {
      module: "inquiry",
      entityId: id,
      action: "convert",
      after: data,
      stamp: `Converted inquiry ${id} -> patient ${data?.patient_id || ""}`
    });
    return data;
  }
};
