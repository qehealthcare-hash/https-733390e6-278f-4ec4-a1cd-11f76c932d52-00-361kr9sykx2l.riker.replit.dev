import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function parseDateOnly(value) {
  if (!value) return null;
  const iso = new Date(value);
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString().slice(0, 10);
}

function uniqueDates(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(function mapDate(value) {
          return parseDateOnly(value);
        })
        .filter(Boolean)
    )
  ).sort();
}

function rowPayoutAmount(row) {
  return Number(row.daily_rate || 0) * Number(row.total_people || 1);
}

function isMissingSchemaError(error) {
  if (!error) return false;
  return ["42P01", "42703", "42883", "PGRST204"].includes(error.code) || /does not exist|Could not find the .* column|function .* does not exist/i.test(error.message || "");
}

function isRetryableSupabaseError(error) {
  if (!error) return false;
  return /timeout|timed out|network|fetch failed|connection|socket|temporarily unavailable/i.test(error.message || "");
}

async function callRpcWithRetry(name, params) {
  let rpcResult = await supabaseAdmin.rpc(name, params);
  if (rpcResult.error && isRetryableSupabaseError(rpcResult.error)) {
    console.warn("[payout] rpc retry", { name, message: rpcResult.error.message });
    rpcResult = await supabaseAdmin.rpc(name, params);
  }
  return rpcResult;
}

async function listLedgerPayouts() {
  const result = await supabaseAdmin
    .from("staff_payouts")
    .select("*, employees(full_name, mobile), patients(full_name), invoices(id, service_month)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissingSchemaError(result.error)) return null;
    throw new HttpError(500, result.error.message);
  }
  return result.data || [];
}

async function getLedgerPayoutById(id) {
  const result = await supabaseAdmin
    .from("staff_payouts")
    .select("*, employees(full_name, mobile), patients(full_name), invoices(id, service_month)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (result.error) {
    if (isMissingSchemaError(result.error)) return null;
    throw new HttpError(result.status || 500, result.error.message);
  }
  return result.data;
}

async function fetchLedgerPayoutCandidateRows(payload) {
  let query = supabaseAdmin
    .from("patient_services")
    .select("daily_rate, total_people, billing_status, service_date, patient_id, invoice_id, service_name")
    .eq("assigned_staff_id", payload.employee_id)
    .is("deleted_at", null)
    .eq("payout_status", "UNPAID");

  if (payload.patient_id) {
    query = query.eq("patient_id", payload.patient_id);
  }
  if (payload.invoice_id) {
    query = query.eq("invoice_id", payload.invoice_id);
  }
  const serviceName = String(payload.service_name || "").trim();
  if (serviceName) {
    query = query.eq("service_name", serviceName);
  }

  const paidWorkDates = uniqueDates(payload.paid_work_dates || []);
  if (paidWorkDates.length) {
    query = query.in("service_date", paidWorkDates);
  } else {
    const from = parseDateOnly(payload.from_date);
    const to = parseDateOnly(payload.to_date);
    if (!from || !to) {
      return { kind: "need_range", rows: [], error: null };
    }
    query = query.gte("service_date", from).lte("service_date", to);
  }

  if (process.env.PAYOUT_REQUIRE_BILLING_PAID === "true") {
    query = query.eq("billing_status", "PAID");
  }

  const result = await query.order("service_date", { ascending: true });
  if (result.error) {
    if (isMissingSchemaError(result.error)) {
      return { kind: "missing_schema", rows: [], error: null };
    }
    throw new HttpError(500, result.error.message);
  }
  return { kind: "ok", rows: result.data || [], error: null };
}

/**
 * Returns null if patient_services is not available (same as legacy-only DB).
 * Otherwise returns { payable, paid } capped to the sum of daily_rate * total_people for matching rows.
 */
async function resolveLedgerPayoutAmounts(payload) {
  const fetched = await fetchLedgerPayoutCandidateRows(payload);
  if (fetched.kind === "missing_schema") {
    return null;
  }
  if (fetched.kind === "need_range") {
    throw new HttpError(400, "From Date and To Date are required for payout unless paid_work_dates is provided");
  }
  const rows = fetched.rows || [];
  const maxPayableRaw = rows.reduce(function sumRows(sum, row) {
    return sum + rowPayoutAmount(row);
  }, 0);
  const maxPayable = Math.round(maxPayableRaw * 100) / 100;

  let payable = Number(payload.payable_amount || 0);
  if (!Number.isFinite(payable) || payable <= 0) {
    payable = maxPayable;
  }
  if (payable > maxPayable + 0.02) {
    throw new HttpError(
      400,
      "Payable amount " + payable + " exceeds the maximum " + maxPayable + " for the selected unpaid work days."
    );
  }

  const paidIn = Number(payload.paid_amount || 0);
  const paid = Math.min(Number.isFinite(paidIn) && paidIn >= 0 ? paidIn : 0, payable);

  const requestedPayable = Number(payload.payable_amount || 0);
  if (Math.abs(payable - requestedPayable) > 0.02) {
    console.info("[payout] adjusted payable or paid to match ledger caps", {
      requestedPayable,
      payable,
      paid,
      maxPayable
    });
  }

  return { payable, paid };
}

async function createLedgerPayout(payload, actor) {
  const resolvedAmounts = await resolveLedgerPayoutAmounts(payload);
  const payableAmount = resolvedAmounts ? resolvedAmounts.payable : Number(payload.payable_amount || 0);
  const paidAmount = resolvedAmounts ? resolvedAmounts.paid : Number(payload.paid_amount || 0);

  console.info("[payout] createLedgerPayout:start", {
    employeeId: payload.employee_id,
    patientId: payload.patient_id || null,
    invoiceId: payload.invoice_id || null,
    serviceName: payload.service_name || null,
    payableAmount,
    paidAmount
  });
  const rpcResult = await callRpcWithRetry("create_staff_payout", {
    p_employee_id: payload.employee_id,
    p_patient_id: payload.patient_id || null,
    p_invoice_id: payload.invoice_id || null,
    p_service_name: payload.service_name || null,
    p_payout_option: payload.payout_option || "MONTHLY",
    p_payout_month: payload.payout_month || null,
    p_from_date: payload.from_date || null,
    p_to_date: payload.to_date || null,
    p_paid_work_dates: payload.paid_work_dates || [],
    p_paid_days: Number(payload.paid_days || 0),
    p_payable_amount: payableAmount,
    p_paid_amount: paidAmount,
    p_payment_mode: payload.payment_mode || null,
    p_proof_file_path: payload.proof_file_path || null,
    p_note: payload.note || "",
    p_actor_user_id: actor.id
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    console.error("[payout] createLedgerPayout:error", rpcResult.error);
    throw new HttpError(400, rpcResult.error.message);
  }
  console.info("[payout] createLedgerPayout:success", {
    payoutId: rpcResult.data ? rpcResult.data.id : null,
    employeeId: payload.employee_id
  });
  return rpcResult.data;
}

async function softDeleteLedgerPayout(payoutId, actor) {
  console.info("[payout] softDeleteLedgerPayout:start", {
    payoutId,
    actorUserId: actor.id
  });
  const rpcResult = await callRpcWithRetry("soft_delete_staff_payout", {
    p_payout_id: payoutId,
    p_actor_user_id: actor.id
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    console.error("[payout] softDeleteLedgerPayout:error", rpcResult.error);
    throw new HttpError(400, rpcResult.error.message);
  }
  console.info("[payout] softDeleteLedgerPayout:success", {
    payoutId,
    employeeId: rpcResult.data ? rpcResult.data.employee_id : null
  });
  return rpcResult.data;
}

async function listLegacyPayouts() {
  const result = await supabaseAdmin
    .from("payout_runs")
    .select("*, employees(full_name, mobile), payout_entries(*), payout_payments(*)")
    .order("created_at", { ascending: false });
  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

async function getLegacyPayoutById(id) {
  const result = await supabaseAdmin
    .from("payout_runs")
    .select("*, employees(full_name, mobile), payout_entries(*, patients(full_name)), payout_payments(*)")
    .eq("id", id)
    .single();
  if (result.error) throw new HttpError(result.status || 500, result.error.message);
  return result.data;
}

async function createLegacyPayout(payload, actor) {
  const total = (payload.entries || []).reduce(function sumEntries(sum, entry) {
    return sum + Number(entry.amount || 0);
  }, 0);
  const runInsert = await supabaseAdmin
    .from("payout_runs")
    .insert({
      employee_id: payload.employee_id,
      payout_month: payload.payout_month,
      total_amount: total,
      pending_amount: total,
      created_by: actor.id
    })
    .select("*")
    .single();
  if (runInsert.error) throw new HttpError(500, runInsert.error.message);

  const entriesInsert = await supabaseAdmin.from("payout_entries").insert(
    (payload.entries || []).map(function mapEntry(entry) {
      return {
        payout_id: runInsert.data.id,
        employee_id: payload.employee_id,
        patient_id: entry.patient_id,
        invoice_item_id: entry.invoice_item_id,
        service_name: entry.service_name,
        total_days: entry.total_days,
        rate_per_day: entry.rate_per_day,
        amount: entry.amount
      };
    })
  );
  if (entriesInsert.error) throw new HttpError(500, entriesInsert.error.message);
  return await getLegacyPayoutById(runInsert.data.id);
}

async function addLegacyPayment(payload, actor) {
  const paymentInsert = await supabaseAdmin
    .from("payout_payments")
    .insert({
      payout_id: payload.payout_id,
      amount_paid: payload.amount_paid,
      payment_mode: payload.payment_mode,
      payment_date: payload.payment_date,
      proof_file_path: payload.proof_file_path || null,
      processed_by: actor.id
    })
    .select("*")
    .single();
  if (paymentInsert.error) throw new HttpError(500, paymentInsert.error.message);

  const payoutsResult = await supabaseAdmin
    .from("payout_runs")
    .select("total_amount")
    .eq("id", payload.payout_id)
    .single();
  if (payoutsResult.error) throw new HttpError(500, payoutsResult.error.message);

  const paymentsResult = await supabaseAdmin
    .from("payout_payments")
    .select("amount_paid")
    .eq("payout_id", payload.payout_id);
  if (paymentsResult.error) throw new HttpError(500, paymentsResult.error.message);

  const paid = (paymentsResult.data || []).reduce(function sumRows(sum, row) {
    return sum + Number(row.amount_paid || 0);
  }, 0);
  const total = Number(payoutsResult.data.total_amount || 0);

  const updateResult = await supabaseAdmin
    .from("payout_runs")
    .update({
      paid_amount: paid,
      pending_amount: Math.max(0, total - paid)
    })
    .eq("id", payload.payout_id);
  if (updateResult.error) throw new HttpError(500, updateResult.error.message);

  return await getLegacyPayoutById(payload.payout_id);
}

export const payoutService = {
  async list() {
    const ledgerRows = await listLedgerPayouts();
    if (ledgerRows) return ledgerRows;
    return await listLegacyPayouts();
  },

  async create(payload, actor) {
    if ((!payload.entries || !payload.entries.length) && (payload.from_date || (payload.paid_work_dates || []).length)) {
      const created = await createLedgerPayout(payload, actor);
      if (created) {
        return await getLedgerPayoutById(created.id);
      }
    }
    return await createLegacyPayout(payload, actor);
  },

  async getById(id) {
    const ledgerRow = await getLedgerPayoutById(id);
    if (ledgerRow) return ledgerRow;
    return await getLegacyPayoutById(id);
  },

  async addPayment(payload, actor) {
    return await addLegacyPayment(payload, actor);
  },

  async delete(id, actor) {
    const deletedLedgerPayout = await softDeleteLedgerPayout(id, actor);
    if (deletedLedgerPayout) {
      return {
        deleted: deletedLedgerPayout,
        employeeId: deletedLedgerPayout.employee_id
      };
    }
    throw new HttpError(404, "Ledger payout delete is not available for this record");
  }
};
