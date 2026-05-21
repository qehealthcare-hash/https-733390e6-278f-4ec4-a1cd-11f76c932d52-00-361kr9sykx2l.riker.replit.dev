import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import { idSchema, isoDate } from "../validation";
import type { ActorContext } from "../auth";

const TABLE = "hh_duties";

export const dutySchema = z
  .object({
    id: idSchema.optional(),
    patient_id: idSchema,
    employee_id: idSchema,
    service_type: z.string().optional().default(""),
    shift_type: z.enum(["DAY", "NIGHT", "24H", "FULL"]).default("DAY"),
    start_at: isoDate,
    end_at: isoDate,
    status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).default("SCHEDULED"),
    cancel_reason: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    billing_id: z.string().optional().nullable()
  })
  .refine((v) => new Date(v.end_at).getTime() > new Date(v.start_at).getTime(), {
    message: "end_at must be after start_at",
    path: ["end_at"]
  });

export type DutyInput = z.infer<typeof dutySchema>;

async function findOverlap(employeeId: string, startAt: string, endAt: string, excludeId?: string) {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, employee_id, start_at, end_at, status")
    .eq("employee_id", employeeId)
    .not("status", "in", "(CANCELLED,NO_SHOW)")
    .lt("start_at", endAt)
    .gt("end_at", startAt);
  if (error) throw error;
  return (data || []).find((r) => r.id !== excludeId) || null;
}

export const dutyService = {
  async list(opts: { limit: number; offset: number; q: string; employeeId?: string; patientId?: string; from?: string; to?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("start_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
    if (opts.patientId) query = query.eq("patient_id", opts.patientId);
    if (opts.from) query = query.gte("start_at", opts.from);
    if (opts.to) query = query.lte("end_at", opts.to);
    if (opts.q) {
      query = query.or(
        ["service_type", "shift_type", "status", "notes"]
          .map((c) => `${c}.ilike.%${opts.q}%`)
          .join(",")
      );
    }
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data || [], total: count ?? data?.length ?? 0 };
  },

  async getById(id: string) {
    const { data, error } = await supabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Duty");
    return data;
  },

  async create(input: DutyInput, actor: ActorContext) {
    const overlap = await findOverlap(input.employee_id, input.start_at, input.end_at);
    if (overlap) {
      throw conflict("Staff already has a duty overlapping this time", { overlap });
    }
    const id = input.id || newId.duty();
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .insert({
        ...input,
        id,
        created_by: actor.email,
        updated_by: actor.email
      })
      .select("*")
      .single();
    if (error) {
      if (error.message.toLowerCase().includes("hh_duties_no_overlap")) {
        throw conflict("Staff already has a duty overlapping this time");
      }
      throw error;
    }
    await audit(actor, { module: "duty", entityId: id, action: "create", after: data });
    return data;
  },

  async update(id: string, input: DutyInput, actor: ActorContext) {
    const existing = await this.getById(id);
    if (existing.status === "COMPLETED" && input.status !== "COMPLETED") {
      throw badRequest("Completed duties cannot be reopened. Create a new duty instead.");
    }
    if (input.status !== "CANCELLED" && input.status !== "NO_SHOW") {
      const overlap = await findOverlap(input.employee_id, input.start_at, input.end_at, id);
      if (overlap) throw conflict("Staff already has a duty overlapping this time", { overlap });
    }
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ ...input, id, updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "duty", entityId: id, action: "update", before: existing, after: data });
    return data;
  },

  async cancel(id: string, reason: string, actor: ActorContext) {
    const existing = await this.getById(id);
    const admin = supabaseAdmin();
    // M4: if this duty already produced a bill line, clean it up — unless a receipt
    // has been recorded against that billing (would corrupt finance).
    if (existing.billing_id) {
      const svcRows = await admin
        .from("hh_svc_entries")
        .select("id")
        .eq("billing_id", existing.billing_id)
        .eq("remarks", `duty:${id}`);
      if (svcRows.data && svcRows.data.length) {
        const receipts = await admin
          .from("hh_receipts")
          .select("id")
          .eq("billing_id", existing.billing_id)
          .is("deleted_at", null);
        if (receipts.data && receipts.data.length) {
          throw conflict("Cannot cancel — receipts have already been recorded against the bill from this duty", {
            billing_id: existing.billing_id,
            receipts: receipts.data
          });
        }
        await admin.from("hh_svc_entries").delete().eq("billing_id", existing.billing_id).eq("remarks", `duty:${id}`);
      }
    }
    const { data, error } = await admin
      .from(TABLE)
      .update({ status: "CANCELLED", cancel_reason: reason || "", updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, {
      module: "duty",
      entityId: id,
      action: "delete",
      before: existing,
      after: data,
      stamp: `Cancelled: ${reason || "no reason"}`
    });
    return data;
  },

  async checkIn(id: string, when: string | undefined, actor: ActorContext) {
    const duty = await this.getById(id);
    const checkInAt = when || new Date().toISOString();
    const admin = supabaseAdmin();
    const attendanceId = newId.attendance();
    const { error: attErr } = await admin
      .from("hh_attendance")
      .upsert(
        {
          id: attendanceId,
          duty_id: id,
          employee_id: duty.employee_id,
          patient_id: duty.patient_id,
          check_in_at: checkInAt,
          status: "PRESENT",
          created_by: actor.email,
          updated_by: actor.email
        },
        { onConflict: "duty_id" }
      );
    if (attErr) throw attErr;
    const { data, error } = await admin
      .from(TABLE)
      .update({ status: "IN_PROGRESS", updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "duty", entityId: id, action: "update", before: duty, after: data, stamp: "Check-in" });
    return data;
  },

  async checkOut(id: string, when: string | undefined, actor: ActorContext) {
    const duty = await this.getById(id);
    const checkOutAt = when || new Date().toISOString();
    const admin = supabaseAdmin();

    const attendance = await admin
      .from("hh_attendance")
      .select("*")
      .eq("duty_id", id)
      .maybeSingle();
    if (attendance.error) throw attendance.error;
    if (!attendance.data) throw badRequest("Duty has no check-in record");

    const hours = Math.max(
      0,
      (new Date(checkOutAt).getTime() - new Date(attendance.data.check_in_at).getTime()) / 3_600_000
    );

    const { error: updErr } = await admin
      .from("hh_attendance")
      .update({ check_out_at: checkOutAt, hours, updated_by: actor.email })
      .eq("id", attendance.data.id);
    if (updErr) throw updErr;

    const { data, error } = await admin
      .from(TABLE)
      .update({ status: "COMPLETED", updated_by: actor.email })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    // M3: payout aggregates by the duty's own month, not the checkout date.
    const period = (duty.start_at || checkOutAt).slice(0, 7);
    if (duty.employee_id) {
      await admin.rpc("hh_recompute_payout", { p_employee_id: duty.employee_id, p_period: period });
    }

    await audit(actor, {
      module: "duty",
      entityId: id,
      action: "update",
      before: duty,
      after: data,
      stamp: `Check-out (${hours.toFixed(2)}h)`
    });
    return data;
  }
};
