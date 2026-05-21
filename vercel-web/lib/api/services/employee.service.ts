import { supabaseAdmin } from "../supabase";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import type { ActorContext } from "../auth";
import { employeeSchema, type EmployeeInput } from "@/validation/employeeValidation";
import {
  employeeToRow as toRow,
  employeeToApi as toApi,
  findActiveEmployeeDuplicate
} from "@/business/employeeRules";
import { phoneSuffix } from "@/business/phoneRules";

export { employeeSchema, type EmployeeInput } from "@/validation/employeeValidation";

const TABLE = "hh_employees";

async function findDuplicatePhone(phone: string, excludeId?: string) {
  const suffix = phoneSuffix(phone);
  if (!suffix) return null;
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, fn, ln, phone, status")
    .ilike("phone", `%${suffix}%`);
  if (error) throw error;
  return findActiveEmployeeDuplicate(data || [], phone, excludeId);
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
