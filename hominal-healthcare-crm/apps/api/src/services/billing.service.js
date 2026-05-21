import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

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
    console.warn("[billing] rpc retry", { name, message: rpcResult.error.message });
    rpcResult = await supabaseAdmin.rpc(name, params);
  }
  return rpcResult;
}

function parseDateOnly(value) {
  if (!value) return null;
  const iso = new Date(value);
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString().slice(0, 10);
}

function buildDateRange(fromDate, toDate) {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate || fromDate);
  if (!start || !end || start > end) return [];
  const out = [];
  const cursor = new Date(start + "T00:00:00.000Z");
  const last = new Date(end + "T00:00:00.000Z");
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
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

function calculateLegacyItemAmount(item) {
  const effectiveDays = Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0));
  return effectiveDays * Number(item.total_people || 1) * Number(item.rate_per_day || 0);
}

function buildServiceDates(item, invoiceMonth) {
  const explicitDates = uniqueDates(item.service_dates || []);
  if (explicitDates.length) return explicitDates;
  const startDate = parseDateOnly(item.service_start_date) || parseDateOnly(invoiceMonth);
  const effectiveDays = Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0));
  if (!startDate || !effectiveDays) return [];
  const out = [];
  const cursor = new Date(startDate + "T00:00:00.000Z");
  for (let index = 0; index < effectiveDays; index += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function serviceRowAmount(row) {
  return Number(row.daily_rate || 0) * Number(row.total_people || 1);
}

function buildInvoiceReceiptSummary(invoice, patientServices, billingReceipts, invoiceItems, legacyReceipts) {
  if (patientServices && billingReceipts) {
    const allRows = patientServices.filter(function filterRows(row) {
      return row.invoice_id === invoice.id && !row.deleted_at;
    });
    const activeReceipts = billingReceipts.filter(function filterReceipts(row) {
      return row.invoice_id === invoice.id && !row.deleted_at;
    });
    const paidKey = new Set();
    activeReceipts.forEach(function addPaidKeys(row) {
      const paidDates = uniqueDates(row.paid_service_dates || buildDateRange(row.from_date, row.to_date));
      paidDates.forEach(function eachDate(dateValue) {
        paidKey.add((row.service_name || "") + "::" + dateValue);
      });
    });

    const totalsByService = {};
    let totalServiceAmount = 0;
    let paidServiceAmount = 0;
    let totalServiceDays = 0;
    let paidServiceDays = 0;

    allRows.forEach(function eachService(row) {
      const key = row.service_name || "Service";
      const amount = serviceRowAmount(row);
      const isPaid = paidKey.has(key + "::" + row.service_date);
      totalServiceAmount += amount;
      totalServiceDays += 1;
      if (isPaid) {
        paidServiceAmount += amount;
        paidServiceDays += 1;
      }
      if (!totalsByService[key]) {
        totalsByService[key] = {
          service_name: key,
          total_days: 0,
          paid_days: 0,
          unpaid_days: 0,
          total_amount: 0,
          paid_amount: 0,
          unpaid_amount: 0
        };
      }
      totalsByService[key].total_days += 1;
      totalsByService[key].total_amount += amount;
      if (isPaid) {
        totalsByService[key].paid_days += 1;
        totalsByService[key].paid_amount += amount;
      } else {
        totalsByService[key].unpaid_days += 1;
        totalsByService[key].unpaid_amount += amount;
      }
    });

    if (!allRows.length) {
      const items = Array.isArray(invoiceItems) ? invoiceItems : [];
      const subtotalFromItems = items.reduce(function sumLegacyItems(sum, item) {
        return sum + Number(item.line_total || calculateLegacyItemAmount(item));
      }, 0);
      totalServiceAmount =
        subtotalFromItems > 0 ? subtotalFromItems : Number(invoice.subtotal_amount || 0);
      const collectedLedger = activeReceipts
        .filter(function skipSecurity(row) {
          return String(row.transaction_type || "PAYMENT").toUpperCase() !== "SECURITY";
        })
        .reduce(function sumReceipts(sum, row) {
          return sum + Number(row.amount || 0);
        }, 0);
      const legacyCollected = (Array.isArray(legacyReceipts) ? legacyReceipts : []).reduce(function sumLegacy(sum, row) {
        return sum + Number(row.amount || 0);
      }, 0);
      paidServiceAmount = collectedLedger + legacyCollected;
      paidServiceDays = activeReceipts.reduce(function sumDays(sum, row) {
        return sum + Number(row.paid_days || 0);
      }, 0);
    }

    const securityCredit =
      invoice.invoice_type === "FINAL" || invoice.status === "CLOSED"
        ? Number(invoice.security_deposit || 0)
        : 0;
    const outstanding = Math.max(0, totalServiceAmount - paidServiceAmount - securityCredit);

    return {
      receipt_source: "billing_receipts",
      patient_services: allRows,
      billing_receipts: activeReceipts,
      total_service_days: totalServiceDays,
      paid_service_days: paidServiceDays,
      unpaid_service_days: Math.max(0, totalServiceDays - paidServiceDays),
      total_service_amount: totalServiceAmount,
      paid_service_amount: paidServiceAmount,
      unpaid_service_amount: Math.max(0, totalServiceAmount - paidServiceAmount),
      outstanding_amount: outstanding,
      services: Object.values(totalsByService)
    };
  }

  const items = Array.isArray(invoiceItems) ? invoiceItems : [];
  const receipts = Array.isArray(legacyReceipts) ? legacyReceipts : [];
  const subtotal = items.reduce(function sumLegacyItems(sum, item) {
    return sum + Number(item.line_total || calculateLegacyItemAmount(item));
  }, 0);
  const collected = receipts.reduce(function sumLegacyReceipts(sum, row) {
    return sum + Number(row.amount || 0);
  }, 0);
  const shouldApplyDeposit = invoice.invoice_type === "FINAL" || invoice.status === "CLOSED";
  const depositCredit = shouldApplyDeposit ? Number(invoice.security_deposit || 0) : 0;
  return {
    receipt_source: "receipts",
    patient_services: [],
    billing_receipts: [],
    total_service_days: items.reduce(function sumDays(sum, item) {
      return sum + Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0));
    }, 0),
    paid_service_days: 0,
    unpaid_service_days: items.reduce(function sumDays(sum, item) {
      return sum + Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0));
    }, 0),
    total_service_amount: subtotal,
    paid_service_amount: collected,
    unpaid_service_amount: Math.max(0, subtotal - collected),
    outstanding_amount: Math.max(0, subtotal - collected - depositCredit),
    services: items.map(function mapItem(item) {
      return {
        service_name: item.service_name,
        total_days: Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0)),
        paid_days: 0,
        unpaid_days: Math.max(0, Number(item.total_days || 0) - Number(item.absent_days || 0)),
        total_amount: Number(item.line_total || calculateLegacyItemAmount(item)),
        paid_amount: 0,
        unpaid_amount: Number(item.line_total || calculateLegacyItemAmount(item))
      };
    })
  };
}

async function listInvoiceRows() {
  const result = await supabaseAdmin
    .from("invoices")
    .select("*, patients(*), invoice_items(*), receipts(*)")
    .order("created_at", { ascending: false });
  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

async function fetchPatientServicesForInvoices(invoiceIds) {
  if (!invoiceIds.length) return [];
  const result = await supabaseAdmin
    .from("patient_services")
    .select("*")
    .in("invoice_id", invoiceIds)
    .order("service_date", { ascending: true });
  if (result.error) {
    if (isMissingSchemaError(result.error)) return null;
    throw new HttpError(500, result.error.message);
  }
  return result.data || [];
}

async function fetchBillingReceiptsForInvoices(invoiceIds) {
  if (!invoiceIds.length) return [];
  const result = await supabaseAdmin
    .from("billing_receipts")
    .select("*")
    .in("invoice_id", invoiceIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissingSchemaError(result.error)) return null;
    throw new HttpError(500, result.error.message);
  }
  return result.data || [];
}

async function fetchLedgerContext(invoiceIds) {
  const [serviceRows, receiptRows] = await Promise.all([
    fetchPatientServicesForInvoices(invoiceIds),
    fetchBillingReceiptsForInvoices(invoiceIds)
  ]);
  return {
    patientServices: serviceRows,
    billingReceipts: receiptRows,
    ledgerReady: Array.isArray(serviceRows) && Array.isArray(receiptRows)
  };
}

function attachInvoiceSummary(invoice, ledgerContext) {
  const invoiceItems = invoice.invoice_items || [];
  const legacyReceipts = invoice.receipts || [];
  const patientServices = ledgerContext.ledgerReady
    ? ledgerContext.patientServices.filter(function filterRows(row) {
        return row.invoice_id === invoice.id;
      })
    : null;
  const billingReceipts = ledgerContext.ledgerReady
    ? ledgerContext.billingReceipts.filter(function filterRows(row) {
        return row.invoice_id === invoice.id;
      })
    : null;

  return {
    ...invoice,
    summary: buildInvoiceReceiptSummary(invoice, patientServices, billingReceipts, invoiceItems, legacyReceipts),
    active_receipts: billingReceipts || legacyReceipts
  };
}

async function createPatientServiceLedger(invoice, items, actor) {
  const rows = [];
  items.forEach(function eachItem(item) {
    const serviceDates = buildServiceDates(item, invoice.service_month);
    serviceDates.forEach(function eachDate(serviceDate) {
      rows.push({
        invoice_id: invoice.id,
        patient_id: invoice.patient_id,
        service_name: item.service_name,
        service_date: serviceDate,
        duration_label: item.duration_label,
        total_people: Number(item.total_people || 1),
        daily_rate: Number(item.rate_per_day || 0),
        assigned_staff_id: item.assigned_staff_id || null,
        created_by: actor.id
      });
    });
  });
  if (!rows.length) return [];
  const insertResult = await supabaseAdmin.from("patient_services").insert(rows).select("*");
  if (insertResult.error) {
    if (isMissingSchemaError(insertResult.error)) return null;
    throw new HttpError(500, insertResult.error.message);
  }
  return insertResult.data || [];
}

async function recalculateInvoiceOutstanding(invoiceId) {
  const rpcResult = await supabaseAdmin.rpc("recalculate_invoice_outstanding", {
    p_invoice_id: invoiceId
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    throw new HttpError(500, rpcResult.error.message);
  }
  return rpcResult.data;
}

async function createLedgerReceipt(payload, actor) {
  const paidDates = uniqueDates(payload.paid_service_dates || buildDateRange(payload.from_date, payload.to_date));
  console.info("[billing] createLedgerReceipt:start", {
    invoiceId: payload.invoice_id,
    patientId: payload.patient_id || null,
    serviceName: payload.service_name || null,
    paidDates: paidDates.length,
    amount: Number(payload.amount || 0)
  });
  const rpcResult = await callRpcWithRetry("create_billing_receipt", {
    p_invoice_id: payload.invoice_id,
    p_patient_id: payload.patient_id || null,
    p_receipt_no: payload.receipt_no || null,
    p_transaction_type: payload.transaction_type || "PAYMENT",
    p_service_name: payload.service_name || null,
    p_bill_mode: payload.bill_mode || "MONTHLY",
    p_from_date: parseDateOnly(payload.from_date),
    p_to_date: parseDateOnly(payload.to_date),
    p_paid_days: Number(payload.paid_days || paidDates.length || 0),
    p_paid_service_dates: paidDates,
    p_amount: Number(payload.amount || 0),
    p_payment_mode: payload.payment_mode,
    p_received_on: parseDateOnly(payload.received_on),
    p_invoice_reference: payload.invoice_reference || null,
    p_note: payload.note || "",
    p_actor_user_id: actor.id
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    console.error("[billing] createLedgerReceipt:error", rpcResult.error);
    throw new HttpError(400, rpcResult.error.message);
  }
  console.info("[billing] createLedgerReceipt:success", {
    invoiceId: payload.invoice_id,
    receiptId: rpcResult.data ? rpcResult.data.id : null
  });
  return rpcResult.data;
}

async function softDeleteLedgerReceipt(receiptId, actor) {
  console.info("[billing] softDeleteLedgerReceipt:start", {
    receiptId,
    actorUserId: actor.id
  });
  const rpcResult = await callRpcWithRetry("soft_delete_billing_receipt", {
    p_receipt_id: receiptId,
    p_actor_user_id: actor.id
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    console.error("[billing] softDeleteLedgerReceipt:error", rpcResult.error);
    throw new HttpError(400, rpcResult.error.message);
  }
  console.info("[billing] softDeleteLedgerReceipt:success", {
    receiptId,
    invoiceId: rpcResult.data ? rpcResult.data.invoice_id : null
  });
  return rpcResult.data;
}

async function restoreLedgerReceipt(receiptId, actor) {
  const rpcResult = await callRpcWithRetry("restore_billing_receipt", {
    p_receipt_id: receiptId,
    p_actor_user_id: actor.id
  });
  if (rpcResult.error) {
    if (isMissingSchemaError(rpcResult.error)) return null;
    throw new HttpError(400, rpcResult.error.message);
  }
  return rpcResult.data;
}

async function loadInvoiceById(id) {
  const result = await supabaseAdmin
    .from("invoices")
    .select("*, patients(*), invoice_items(*), receipts(*)")
    .eq("id", id)
    .single();
  if (result.error) throw new HttpError(result.status || 500, result.error.message);
  return result.data;
}

async function addLegacyReceipt(payload, actor) {
  const receiptInsert = await supabaseAdmin
    .from("receipts")
    .insert({
      invoice_id: payload.invoice_id,
      amount: payload.amount,
      payment_mode: payload.payment_mode,
      received_on: payload.received_on,
      note: payload.note,
      received_by: actor.id
    })
    .select("*")
    .single();
  if (receiptInsert.error) throw new HttpError(500, receiptInsert.error.message);

  const receiptsResult = await supabaseAdmin
    .from("receipts")
    .select("amount")
    .eq("invoice_id", payload.invoice_id);
  if (receiptsResult.error) throw new HttpError(500, receiptsResult.error.message);

  const invoiceResult = await supabaseAdmin
    .from("invoices")
    .select("subtotal_amount, security_deposit, invoice_type, status")
    .eq("id", payload.invoice_id)
    .single();
  if (invoiceResult.error) throw new HttpError(500, invoiceResult.error.message);

  const collected = (receiptsResult.data || []).reduce(function (sum, row) {
    return sum + Number(row.amount || 0);
  }, 0);
  const subtotal = Number(invoiceResult.data.subtotal_amount || 0);
  const shouldApplyDeposit = invoiceResult.data.invoice_type === "FINAL" || invoiceResult.data.status === "CLOSED";
  const depositCredit = shouldApplyDeposit ? Number(invoiceResult.data.security_deposit || 0) : 0;
  const outstanding = Math.max(0, subtotal - depositCredit - collected);

  const updateInvoice = await supabaseAdmin
    .from("invoices")
    .update({ outstanding_amount: outstanding })
    .eq("id", payload.invoice_id);
  if (updateInvoice.error) throw new HttpError(500, updateInvoice.error.message);

  return {
    ...receiptInsert.data,
    receipt_source: "receipts"
  };
}

async function deleteLegacyReceipt(receiptId) {
  const existing = await supabaseAdmin.from("receipts").select("id, invoice_id").eq("id", receiptId).single();
  if (existing.error) throw new HttpError(existing.status || 500, existing.error.message);

  const deleteResult = await supabaseAdmin.from("receipts").delete().eq("id", receiptId);
  if (deleteResult.error) throw new HttpError(500, deleteResult.error.message);

  const invoiceId = existing.data.invoice_id;
  const invoiceResult = await supabaseAdmin
    .from("invoices")
    .select("subtotal_amount, security_deposit, invoice_type, status")
    .eq("id", invoiceId)
    .single();
  if (invoiceResult.error) throw new HttpError(500, invoiceResult.error.message);

  const receiptsResult = await supabaseAdmin
    .from("receipts")
    .select("amount")
    .eq("invoice_id", invoiceId);
  if (receiptsResult.error) throw new HttpError(500, receiptsResult.error.message);

  const collected = (receiptsResult.data || []).reduce(function (sum, row) {
    return sum + Number(row.amount || 0);
  }, 0);
  const subtotal = Number(invoiceResult.data.subtotal_amount || 0);
  const shouldApplyDeposit = invoiceResult.data.invoice_type === "FINAL" || invoiceResult.data.status === "CLOSED";
  const depositCredit = shouldApplyDeposit ? Number(invoiceResult.data.security_deposit || 0) : 0;
  const outstanding = Math.max(0, subtotal - depositCredit - collected);

  const updateInvoice = await supabaseAdmin
    .from("invoices")
    .update({ outstanding_amount: outstanding })
    .eq("id", invoiceId);
  if (updateInvoice.error) throw new HttpError(500, updateInvoice.error.message);

  return { id: receiptId, invoice_id: invoiceId, deleted: true, receipt_source: "receipts" };
}

export const billingService = {
  async list() {
    const invoices = await listInvoiceRows();
    const ledgerContext = await fetchLedgerContext(
      invoices.map(function mapInvoice(invoice) {
        return invoice.id;
      })
    );
    return invoices.map(function mapInvoice(invoice) {
      return attachInvoiceSummary(invoice, ledgerContext);
    });
  },

  async getById(id) {
    const invoice = await loadInvoiceById(id);
    const ledgerContext = await fetchLedgerContext([id]);
    return attachInvoiceSummary(invoice, ledgerContext);
  },

  async create(payload, actor) {
    const totals = payload.items.map(function mapItem(item) {
      return {
        ...item,
        service_start_date: parseDateOnly(item.service_start_date) || parseDateOnly(payload.service_month),
        service_dates: uniqueDates(item.service_dates || []),
        line_total: calculateLegacyItemAmount(item)
      };
    });
    const gross = totals.reduce(function sumItems(sum, item) {
      return sum + item.line_total;
    }, 0);
    const outstanding =
      payload.invoice_type === "FINAL" ? Math.max(0, gross - Number(payload.security_deposit || 0)) : gross;

    const invoiceInsert = await supabaseAdmin
      .from("invoices")
      .insert({
        patient_id: payload.patient_id,
        service_month: payload.service_month,
        invoice_type: payload.invoice_type,
        security_deposit: payload.security_deposit,
        status: payload.status,
        close_reason: payload.close_reason || null,
        subtotal_amount: gross,
        outstanding_amount: outstanding,
        created_by: actor.id
      })
      .select("*")
      .single();
    if (invoiceInsert.error) throw new HttpError(500, invoiceInsert.error.message);

    const itemInsert = await supabaseAdmin
      .from("invoice_items")
      .insert(
        totals.map(function mapInvoiceItem(item) {
          return {
            invoice_id: invoiceInsert.data.id,
            patient_id: payload.patient_id,
            assigned_staff_id: item.assigned_staff_id || null,
            service_name: item.service_name,
            duration_label: item.duration_label,
            total_days: item.total_days,
            total_people: item.total_people,
            rate_per_day: item.rate_per_day,
            absent_days: item.absent_days || 0,
            line_total: item.line_total
          };
        })
      )
      .select("*");
    if (itemInsert.error) throw new HttpError(500, itemInsert.error.message);

    await createPatientServiceLedger(invoiceInsert.data, totals, actor);
    await recalculateInvoiceOutstanding(invoiceInsert.data.id);
    return await this.getById(invoiceInsert.data.id);
  },

  async updateStatus(id, status, closeReason, actor) {
    const updatePayload = {
      status,
      close_reason: closeReason || null,
      updated_by: actor.id
    };
    const invoiceUpdate = await supabaseAdmin
      .from("invoices")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();
    if (invoiceUpdate.error) throw new HttpError(500, invoiceUpdate.error.message);
    if (status === "CLOSED") {
      const patientId = invoiceUpdate.data.patient_id;
      const patientUpdate = await supabaseAdmin
        .from("patients")
        .update({
          status: "CLOSED",
          close_reason: closeReason || "Invoice closed"
        })
        .eq("id", patientId);
      if (patientUpdate.error && !isMissingSchemaError(patientUpdate.error)) {
        throw new HttpError(500, patientUpdate.error.message);
      }
      const legacyPatientUpdate = await supabaseAdmin
        .from("hh_patients")
        .update({
          status: "Closed"
        })
        .eq("id", patientId);
      if (legacyPatientUpdate.error && !isMissingSchemaError(legacyPatientUpdate.error)) {
        console.warn("[billing] hh_patients status update skipped", legacyPatientUpdate.error.message);
      }
    }
    await recalculateInvoiceOutstanding(id);
    return await this.getById(id);
  },

  async addReceipt(payload, actor) {
    const servicesProbe = await supabaseAdmin
      .from("patient_services")
      .select("id")
      .eq("invoice_id", payload.invoice_id)
      .is("deleted_at", null)
      .limit(1);
    const hasLedgerRows =
      !servicesProbe.error &&
      !isMissingSchemaError(servicesProbe.error) &&
      (servicesProbe.data || []).length > 0;

    if (hasLedgerRows) {
      const txn = String(payload.transaction_type || "PAYMENT").toUpperCase();
      if (txn !== "SECURITY") {
        const serviceName = String(payload.service_name || "").trim();
        const fromOk = parseDateOnly(payload.from_date);
        const toOk = parseDateOnly(payload.to_date);
        const explicitDates = Array.isArray(payload.paid_service_dates) && payload.paid_service_dates.length > 0;
        if (!serviceName || (!explicitDates && (!fromOk || !toOk))) {
          throw new HttpError(
            400,
            "This invoice uses day-level billing. Send service_name plus either paid_service_dates or both from_date and to_date so the correct service days can be marked paid."
          );
        }
      }
      await createLedgerReceipt(payload, actor);
      await recalculateInvoiceOutstanding(payload.invoice_id);
      return await this.getById(payload.invoice_id);
    }

    await addLegacyReceipt(payload, actor);
    return await this.getById(payload.invoice_id);
  },

  async restoreReceipt(receiptId, actor) {
    const restored = await restoreLedgerReceipt(receiptId, actor);
    if (restored) {
      await recalculateInvoiceOutstanding(restored.invoice_id);
      return {
        restored,
        invoice: await this.getById(restored.invoice_id)
      };
    }
    throw new HttpError(400, "Receipt restore is only available for ledger billing receipts.");
  },

  async deleteReceipt(receiptId, actor) {
    const deletedLedgerReceipt = await softDeleteLedgerReceipt(receiptId, actor);
    if (deletedLedgerReceipt) {
      return {
        deleted: deletedLedgerReceipt,
        invoice: await this.getById(deletedLedgerReceipt.invoice_id)
      };
    }
    const deletedLegacyReceipt = await deleteLegacyReceipt(receiptId);
    return {
      deleted: deletedLegacyReceipt,
      invoice: await this.getById(deletedLegacyReceipt.invoice_id)
    };
  }
};
