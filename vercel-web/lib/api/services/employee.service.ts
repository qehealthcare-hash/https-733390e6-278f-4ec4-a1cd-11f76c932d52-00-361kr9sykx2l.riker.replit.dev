import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { idSchema } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_employees";

export const employeeSchema = z
  .object({
    id: idSchema.optional(),
    fn: z.string().trim().optional(),
    ln: z.string().trim().optional(),
    mn: z.string().trim().optional().default(""),
    name: z.string().trim().optional(),
    full_name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    email: z.string().email().optional().or(z.literal("")),
    gender: z.string().optional().default(""),
    dob: z.string().optional().default(""),
    addr: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    dept: z.string().optional().default(""),
    desig: z.string().optional().default(""),
    emp_type: z.string().optional().default(""),
    etype: z.string().optional(),
    shift: z.string().optional().default(""),
    salary: z.coerce.number().optional().default(0),
    status: z.string().optional().default("Active"),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    const hasName = v.fn || v.ln || v.name || v.full_name;
    if (!hasName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["fn"] });
    const hasPhone = v.phone || v.mobile;
    if (!hasPhone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
  })
  .transform((v) => {
    const full = (v.name || v.full_name || `${v.fn || ""} ${v.ln || ""}`).trim();
    const parts = full.split(/\s+/);
    return {
      ...v,
      fn: v.fn || parts[0] || "",
      ln: v.ln || (parts.length > 1 ? parts[parts.length - 1] : ""),
      mn: v.mn || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
      phone: (v.phone || v.mobile || "").replace(/[^0-9+]/g, ""),
      emp_type: v.emp_type || v.etype || "",
      etype: v.etype || v.emp_type || ""
    };
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;

function toRow(input: EmployeeInput) {
  return {
    fn: input.fn,
    mn: input.mn,
    ln: input.ln,
    phone: input.phone,
    email: input.email || "",
    gender: input.gender,
    dob: input.dob,
    addr: input.addr,
    area: input.area,
    city: input.city,
    pin: input.pin,
    dept: input.dept,
    desig: input.desig,
    emp_type: input.emp_type,
    etype: input.etype,
    shift: input.shift,
    salary: input.salary,
    status: input.status,
    relname: input.relname,
    relphone: input.relphone,
    docs: input.docs ?? undefined
  };
}

function toApi(row: Record<string, any>) {
  if (!row) return row;
  const full = [row.fn, row.mn, row.ln].filter(Boolean).join(" ").trim();
  return {
    id: row.id,
    full_name: full,
    name: full,
    fn: row.fn || "",
    mn: row.mn || "",
    ln: row.ln || "",
    phone: row.phone || "",
    mobile: row.phone || "",
    email: row.email || "",
    gender: row.gender || "",
    dob: row.dob || "",
    addr: row.addr || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    pin: row.pin || "",
    department: row.dept || "",
    designation: row.desig || "",
    employee_type: row.emp_type || row.etype || "",
    shift: row.shift || "",
    salary: Number(row.salary || 0),
    status: row.status || "Active",
    relname: row.relname || "",
    relphone: row.relphone || "",
    docs: row.docs || [],
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

async function findDuplicatePhone(phone: string, excludeId?: string) {
  const normalized = (phone || "").replace(/[^0-9+]/g, "");
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, fn, ln, phone, status")
    .ilike("phone", `%${normalized.slice(-8)}%`);
  if (error) throw error;
  return (data || []).find((r) => r.id !== excludeId && (r.status || "Active") === "Active") || null;
}

export const employeeService = {
  async list(opts: { limit: number; offset: number; q: string; status?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.q) {
      query = query.or(
        ["fn", "ln", "mn", "phone", "email", "desig", "dept"]
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
    if (!data) throw notFound("Employee");
    return toApi(data);
  },

  async create(input: EmployeeInput, actor: ActorContext) {
    if (input.phone) {
      const dup = await findDuplicatePhone(input.phone);
      if (dup) throw conflict("Active employee already exists for this mobile", { existingId: dup.id });
    }
    const id = input.id || newId.employee();
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

  async update(id: string, input: EmployeeInput, actor: ActorContext) {
    const existing = await this.getById(id);
    if (input.phone && input.phone !== existing.phone) {
      const dup = await findDuplicatePhone(input.phone, id);
      if (dup) throw conflict("Another active employee uses this mobile", { existingId: dup.id });
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
      .update({ status: "Inactive", updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "employee", entityId: id, action: "delete", before: existing, after: data });
    return toApi(data);
  }
};
