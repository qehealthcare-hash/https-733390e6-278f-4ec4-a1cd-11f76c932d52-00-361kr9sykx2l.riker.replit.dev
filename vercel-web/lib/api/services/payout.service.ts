import { supabaseAdmin } from "../supabase";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import type { ActorContext } from "../auth";
import {
  payoutSchema,
  type PayoutInput,
  type PayoutAdjustmentInput,
  type PayoutPayInput
} from "@/validation/payoutValidation";

export {
  payoutSchema,
  payoutAdjustmentSchema,
  payoutPaySchema,
  type PayoutInput,
  type PayoutAdjustmentInput,
  type PayoutPayInput
} from "@/validation/payoutValidation";

const TABLE = "hh_payouts";

export const payoutService = {
  async list(opts: { limit: number; offset: number; period?: string; employeeId?: string; status?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("period_month", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.period) query = query.eq("period_month", opts.period);
    if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
    if (opts.status) query = query.eq("status", opts.status);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data || [], total: count ?? data?.length ?? 0 };
  },

  async getById(id: string) {
    const { data, error } = await supabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Payout");
    return data;
  },

  async ensure(input: PayoutInput, actor: ActorContext) {
    const admin = supabaseAdmin();
    const { data: rpcData, error: rpcErr } = await admin.rpc("hh_recompute_payout", {
      p_employee_id: input.employee_id,
      p_period: input.period_month
    });
    if (rpcErr) throw rpcErr;
    const payoutId = rpcData?.payout_id;
    if (!payoutId) throw new Error("hh_recompute_payout returned no payout_id");

    const { data: row, error: getErr } = await admin.from(TABLE).select("*").eq("id", payoutId).single();
    if (getErr) throw getErr;

    const updates = {
      advance: input.advance ?? row.advance ?? 0,
      deduction: input.deduction ?? row.deduction ?? 0,
      bonus: input.bonus ?? row.bonus ?? 0,
      remarks: input.remarks || row.remarks || ""
    };
    const net = Number(row.gross_amount || 0) + Number(updates.bonus || 0) - Number(updates.advance || 0) - Number(updates.deduction || 0);
    const { data, error } = await admin
      .from(TABLE)
      .update({ ...updates, net_amount: net, updated_by: actor.email })
      .eq("id", payoutId)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "payout", entityId: payoutId, action: "update", before: row, after: data, stamp: "Recompute payout" });
    return data;
  },

  async adjust(input: PayoutAdjustmentInput, actor: ActorContext) {
    const existing = await this.getById(input.payout_id);
    if (existing.status === "PAID") throw conflict("Cannot adjust a PAID payout");
    const advance = input.advance ?? Number(existing.advance || 0);
    const deduction = input.deduction ?? Number(existing.deduction || 0);
    const bonus = input.bonus ?? Number(existing.bonus || 0);
    const net = Number(existing.gross_amount || 0) + bonus - advance - deduction;
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .update({ advance, deduction, bonus, remarks: input.remarks ?? existing.remarks, net_amount: net, updated_by: actor.email })
      .eq("id", input.payout_id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(actor, { module: "payout", entityId: input.payout_id, action: "update", before: existing, after: data, stamp: "Adjust advance/deduction/bonus" });
    return data;
  },

  async markPaid(input: PayoutPayInput, actor: ActorContext) {
    const existing = await this.getById(input.payout_id);
    if (existing.status === "PAID") throw conflict("Payout already paid");
    const admin = supabaseAdmin();
    const paidOn = input.paid_on || new Date().toISOString();
    const { data, error } = await admin
      .from(TABLE)
      .update({ status: "PAID", paid_at: paidOn, updated_by: actor.email })
      .eq("id", input.payout_id)
      .select("*")
      .single();
    if (error) throw error;

    await admin.from("hh_paid_transactions").upsert(
      {
        id: input.payout_id,
        partner: existing.employee_id,
        paid_on: paidOn.slice(0, 10),
        amount: Number(existing.net_amount || 0),
        method: input.method,
        photo: input.photo
      },
      { onConflict: "id" }
    );

    await audit(actor, { module: "payout", entityId: input.payout_id, action: "update", before: existing, after: data, stamp: "Marked PAID" });
    return data;
  }
};
