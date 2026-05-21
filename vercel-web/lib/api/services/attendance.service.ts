import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { badRequest, notFound, conflict } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { idSchema, isoDate } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_attendance";

export const attendanceSchema = z.object({
  id: idSchema.optional(),
  duty_id: z.string().optional(),
  employee_id: idSchema,
  patient_id: z.string().optional(),
  check_in_at: isoDate.optional(),
  check_out_at: isoDate.optional(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"]).default("PRESENT"),
  notes: z.string().optional().default("")
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;

function hoursBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return 0;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return diff > 0 ? Math.round((diff / 3_600_000) * 100) / 100 : 0;
}

export const attendanceService = {
  async list(opts: { limit: number; offset: number; employeeId?: string; dutyId?: string; status?: string; from?: string; to?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("check_in_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
    if (opts.dutyId) query = query.eq("duty_id", opts.dutyId);
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.from) query = query.gte("check_in_at", opts.from);
    if (opts.to) query = query.lte("check_in_at", opts.to);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data || [], total: count ?? data?.length ?? 0 };
  },

  async getById(id: string) {
    const { data, error } = await supabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Attendance");
    return data;
  },

  async create(input: AttendanceInput, actor: ActorContext) {
    const admin = supabaseAdmin();
    if (input.duty_id) {
      const dup = await admin.from(TABLE).select("id").eq("duty_id", input.duty_id).maybeSingle();
      if (dup.data) throw conflict("Attendance already recorded for this duty", { existingId: dup.data.id });
    }
    const id = input.id || newId.attendance();
    const row = {
      id,
      duty_id: input.duty_id || null,
      employee_id: input.employee_id,
      patient_id: input.patient_id || null,
      check_in_at: input.check_in_at || new Date().toISOString(),
      check_out_at: input.check_out_at || null,
      hours: hoursBetween(input.check_in_at, input.check_out_at),
      status: input.status,
      notes: input.notes,
      created_by: actor.email,
      updated_by: actor.email
    };
    const { data, error } = await admin.from(TABLE).insert(row).select("*").single();
    if (error) {
      if (String(error.message).toLowerCase().includes("uq_hh_attendance_per_duty")) {
        throw conflict("Attendance already recorded for this duty");
      }
      throw error;
    }
    return data;
  },

  async update(id: string, input: AttendanceInput, actor: ActorContext) {
    const existing = await this.getById(id);
    const checkIn = input.check_in_at || existing.check_in_at;
    const checkOut = input.check_out_at || existing.check_out_at;
    if (!checkIn) throw badRequest("check_in_at is required");
    const update = {
      check_in_at: checkIn,
      check_out_at: checkOut || null,
      hours: hoursBetween(checkIn, checkOut || undefined),
      status: input.status,
      notes: input.notes ?? existing.notes,
      updated_by: actor.email
    };
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    if (existing.employee_id && checkIn) {
      const period = checkIn.slice(0, 7);
      await supabaseAdmin().rpc("hh_recompute_payout", { p_employee_id: existing.employee_id, p_period: period });
    }
    await audit(actor, { module: "attendance", entityId: id, action: "update", before: existing, after: data });
    return data;
  },

  async remove(id: string, actor: ActorContext) {
    const existing = await this.getById(id);
    const { error } = await supabaseAdmin().from(TABLE).delete().eq("id", id);
    if (error) throw error;
    await audit(actor, { module: "attendance", entityId: id, action: "delete", before: existing });
    return { id };
  }
};
