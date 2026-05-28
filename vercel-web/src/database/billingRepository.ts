import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  listAll,
  callRpc,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/utils/searchTerm";

const BILLINGS = "hh_billings";
const RECEIPTS = "hh_receipts";
const SVC = "hh_svc_entries";
const PAYOUT_CHARGES = "hh_payout_charges";
const INVOICES = "hh_invoices";
const INVOICE_LINES = "hh_invoice_lines";
const SCOPE = "billingRepository";

export interface BillingListFilters extends ListQuery {
  patient_id?: string;
  status?: string;
  q?: string;
}

export const billingRepository = {
  // --- Billings ---

  findBillingById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(BILLINGS, id, SCOPE, opts);
  },

  findActiveByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from(BILLINGS).select("*").eq("patient_id", patientId).eq("status", "Active").maybeSingle(),
      `${SCOPE}.findActiveByPatient`
    );
  },

  /** Latest bill for a patient regardless of status (used to surface a closed bill on refresh). */
  findLatestByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(BILLINGS)
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `${SCOPE}.findLatestByPatient`
    );
  },

  listBillings(filters: BillingListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      BILLINGS,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.patient_id) query = query.eq("patient_id", filters.patient_id);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.q) {
          const term = sanitizeSearchTerm(filters.q);
          if (term) {
            query = query.or(
              ["id", "patient_id", "status"]
                .map((c) => `${c}.ilike.%${term}%`)
                .join(",")
            );
          }
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  listBillingsByIds(ids: string[], opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => db.from(BILLINGS).select("*").in("id", unique).order("created_at", { ascending: false }),
      `${SCOPE}.listBillingsByIds`
    );
  },

  listBillingsByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(BILLINGS, SCOPE, (q) => q.eq("patient_id", patientId), {
      ...opts,
      orderBy: "created_at",
      ascending: false
    });
  },

  insertBilling(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(BILLINGS, row, SCOPE, opts);
  },

  /** Allocate the next sequential invoice number (year-stamped). */
  nextInvoiceNoRpc(opts?: DbAccess): Promise<ApiResult<string | null>> {
    return callRpc<string>("hh_next_invoice_no", {}, `${SCOPE}.nextInvoiceNoRpc`, opts);
  },

  /** Allocate the next sequential receipt number (year-stamped). */
  nextReceiptNoRpc(opts?: DbAccess): Promise<ApiResult<string | null>> {
    return callRpc<string>("hh_next_receipt_no", {}, `${SCOPE}.nextReceiptNoRpc`, opts);
  },

  updateBilling(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(BILLINGS, id, patch, SCOPE, opts);
  },

  /**
   * Atomically flip billing status Active <-> Closed under a patient-scoped
   * `pg_advisory_xact_lock` + `SELECT … FOR UPDATE`. Used after duty cap /
   * resume so two operators cannot leave shortened diaries with a still-Active
   * bill (or duplicate Active rows on reopen).
   */
  flipBillingStatusRpc(
    billingId: string,
    targetStatus: "Active" | "Closed",
    actorEmail: string,
    closedAt?: string | null,
    opts?: DbAccess
  ): Promise<
    ApiResult<{ ok: boolean; billing?: JsonRow; code?: string; message?: string } | null>
  > {
    return callRpc<{ ok: boolean; billing?: JsonRow; code?: string; message?: string }>(
      "hominal_flip_billing_status",
      {
        p_billing_id: billingId,
        p_target_status: targetStatus,
        p_actor: actorEmail,
        p_closed_at: closedAt ?? null
      },
      `${SCOPE}.flipBillingStatusRpc`,
      opts
    );
  },

  removeBilling(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(BILLINGS, id, SCOPE, opts);
  },

  // --- Receipts ---

  findReceiptById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(RECEIPTS, id, SCOPE, opts);
  },

  listReceiptsByBilling(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(
      RECEIPTS,
      SCOPE,
      (q) => q.eq("billing_id", billingId).is("deleted_at", null),
      {
      ...opts,
      orderBy: "date",
      ascending: true
    }
    );
  },

  listAllReceipts(opts?: DbAccess & { orderBy?: string }): Promise<ApiResult<JsonRow[]>> {
    return listAll(RECEIPTS, SCOPE, (q) => q.is("deleted_at", null), {
      ...opts,
      orderBy: opts?.orderBy ?? "date",
      ascending: false
    });
  },

  receiptExists(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(RECEIPTS, id, `${SCOPE}.receiptExists`, opts, "id");
  },

  /** Legacy RPC — persists receipt + ledger side effects atomically in Postgres. */
  saveReceiptRpc(receipt: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return callRpc<JsonRow>("hominal_save_receipt", { p_receipt: receipt }, SCOPE, opts);
  },

  /**
   * P1-18: single atomic receipt save. Wraps `hominal_save_receipt` plus a
   * paid_status recompute inside the same Postgres transaction so two
   * concurrent receipts can't leave the bill in PARTIAL when it's actually
   * PAID. Returns the receipt row augmented with the just-computed
   * `paid_status`.
   */
  saveReceiptV2Rpc(receipt: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return callRpc<JsonRow>(
      "hominal_save_receipt_v2",
      { p_receipt: receipt },
      `${SCOPE}.saveReceiptV2Rpc`,
      opts
    );
  },

  /**
   * Replace the entire `hh_svc_entries` slice for a given `svc_key`.
   * Backed by `hominal_replace_service_entries(p_svc_key, p_rows)`. Returns
   * the row count inserted.
   */
  replaceSvcEntriesRpc(
    svcKey: string,
    rows: JsonRow[],
    opts?: DbAccess
  ): Promise<ApiResult<number | null>> {
    return callRpc<number>(
      "hominal_replace_service_entries",
      { p_svc_key: svcKey, p_rows: rows },
      `${SCOPE}.replaceSvcEntriesRpc`,
      opts
    );
  },

  /** Soft-delete a receipt via the audited DB RPC. */
  softDeleteReceiptRpc(
    receiptId: string,
    billingId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    return callRpc<JsonRow>(
      "hominal_soft_delete_receipt",
      {
        p_receipt_id: receiptId,
        p_billing_id: billingId,
        p_deleted_by: actor
      },
      `${SCOPE}.softDeleteReceiptRpc`,
      opts
    );
  },

  insertReceipt(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(RECEIPTS, row, `${SCOPE}.insertReceipt`, opts);
  },

  updateReceipt(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(RECEIPTS, id, patch, `${SCOPE}.updateReceipt`, opts);
  },

  removeReceipt(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(RECEIPTS, id, `${SCOPE}.removeReceipt`, opts);
  },

  // --- Service entries ---

  findSvcById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(SVC, id, SCOPE, opts);
  },

  listSvcByBilling(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(SVC, SCOPE, (q) => q.eq("billing_id", billingId), {
      ...opts,
      orderBy: "date",
      ascending: true
    });
  },

  findSvcByDutyRemark(billingId: string, dutyId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(SVC)
          .select("*")
          .eq("billing_id", billingId)
          .eq("remarks", `duty:${dutyId}`)
          .maybeSingle(),
      `${SCOPE}.findSvcByDutyRemark`
    );
  },

  /** Look up an svc row for a duty across *any* billing (post-reopen edge case). */
  findSvcByDutyAcrossBillings(dutyId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(SVC)
          .select("*")
          .eq("remarks", `duty:${dutyId}`)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `${SCOPE}.findSvcByDutyAcrossBillings`
    );
  },

  /** Service entries inside a billing constrained to a YYYY-MM period. */
  async listSvcByBillingAndPeriod(
    billingId: string,
    periodYM: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const start = `${periodYM}-01`;
    const [y, m] = periodYM.split("-").map((n) => parseInt(n, 10));
    const nextMonth = new Date(Date.UTC(y, m, 1));
    const end = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(SVC)
          .select("*")
          .eq("billing_id", billingId)
          .gte("date", start)
          .lt("date", end)
          .order("date", { ascending: true }),
      `${SCOPE}.listSvcByBillingAndPeriod`
    );
  },

  /** All svc rows for a set of billings (list page enrichment). */
  listSvcByBillingIds(billingIds: string[], opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    if (!billingIds.length) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(SVC)
          .select("*")
          .in("billing_id", billingIds)
          .order("date", { ascending: true }),
      `${SCOPE}.listSvcByBillingIds`
    );
  },

  /** Active receipts for a set of billings (list page enrichment). */
  listActiveReceiptsByBillingIds(
    billingIds: string[],
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!billingIds.length) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .select("*")
          .in("billing_id", billingIds)
          .is("deleted_at", null)
          .order("date", { ascending: true }),
      `${SCOPE}.listActiveReceiptsByBillingIds`
    );
  },

  /** Active (non-soft-deleted) receipts attached to a billing. */
  async listActiveReceiptsByBilling(
    billingId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .select("*")
          .eq("billing_id", billingId)
          .is("deleted_at", null)
          .order("date", { ascending: true }),
      `${SCOPE}.listActiveReceiptsByBilling`
    );
  },

  /**
   * For dashboard / reports parity: sum of svc totals for a given period
   * across *all* billings. The legacy dashboard sums these client-side; we
   * surface a canonical aggregate so the UI doesn't drift.
   */
  async sumServiceTotalsForPeriod(
    periodYM: string,
    opts?: DbAccess
  ): Promise<ApiResult<{ total: number; rows: JsonRow[] }>> {
    const start = `${periodYM}-01`;
    const [y, m] = periodYM.split("-").map((n) => parseInt(n, 10));
    const nextMonth = new Date(Date.UTC(y, m, 1));
    const end = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(SVC)
          .select("billing_id, total, amt, count, date")
          .gte("date", start)
          .lt("date", end),
      `${SCOPE}.sumServiceTotalsForPeriod`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    const rows = result.data || [];
    const total = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
    return { success: true, data: { total, rows } };
  },

  findSvcDuplicate(
    billingId: string,
    date: string,
    serviceName: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(SVC)
          .select("id")
          .eq("billing_id", billingId)
          .eq("date", date)
          .eq("service_name", serviceName)
          .maybeSingle(),
      `${SCOPE}.findSvcDuplicate`
    );
  },

  findSvcByDayPartner(
    billingId: string,
    serviceName: string,
    date: string,
    partnerId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    let q = db
      .from(SVC)
      .select("*")
      .eq("billing_id", billingId)
      .eq("service_name", serviceName)
      .eq("date", date);
    if (partnerId) q = q.eq("partner_id", partnerId);
    else q = q.is("partner_id", null);
    return runQuery(() => q.maybeSingle(), `${SCOPE}.findSvcByDayPartner`);
  },

  findPayoutByDayPartner(
    svcKey: string,
    date: string,
    partnerId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    let q = db.from(PAYOUT_CHARGES).select("*").eq("svc_key", svcKey).eq("date", date);
    if (partnerId) q = q.eq("partner_id", partnerId);
    else q = q.is("partner_id", null);
    return runQuery(() => q.maybeSingle(), `${SCOPE}.findPayoutByDayPartner`);
  },

  insertSvc(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(SVC, row, `${SCOPE}.insertSvc`, opts);
  },

  insertPayoutCharge(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(PAYOUT_CHARGES, row, `${SCOPE}.insertPayoutCharge`, opts);
  },

  updateSvc(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(SVC, id, patch, `${SCOPE}.updateSvc`, opts);
  },

  updatePayoutCharge(
    id: string | number,
    patch: JsonRow,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    return updateRow(PAYOUT_CHARGES, String(id), patch, `${SCOPE}.updatePayoutCharge`, opts);
  },

  removeSvc(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(SVC, id, `${SCOPE}.removeSvc`, opts);
  },

  removePayoutCharge(id: string | number, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(PAYOUT_CHARGES, String(id), `${SCOPE}.removePayoutCharge`, opts);
  },

  // --- Invoices (per-period generation) ---

  findInvoiceById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(INVOICES, id, SCOPE, opts);
  },

  listInvoicesByBilling(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(INVOICES, SCOPE, (q) => q.eq("billing_id", billingId), {
      ...opts,
      orderBy: "created_at",
      ascending: false
    });
  },

  listInvoicesByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(INVOICES, SCOPE, (q) => q.eq("patient_id", patientId), {
      ...opts,
      orderBy: "created_at",
      ascending: false
    });
  },

  findInvoiceForPeriod(
    billingId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(INVOICES)
          .select("*")
          .eq("billing_id", billingId)
          .eq("kind", "MONTHLY")
          .eq("period", period)
          .neq("status", "CANCELLED")
          .maybeSingle(),
      `${SCOPE}.findInvoiceForPeriod`
    );
  },

  insertInvoice(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(INVOICES, row, `${SCOPE}.insertInvoice`, opts);
  },

  updateInvoice(
    id: string,
    patch: JsonRow,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    return updateRow(INVOICES, id, patch, `${SCOPE}.updateInvoice`, opts);
  },

  insertInvoiceLines(
    rows: JsonRow[],
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[] | null>> {
    if (!rows.length) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => db.from(INVOICE_LINES).insert(rows).select("*"),
      `${SCOPE}.insertInvoiceLines`
    );
  },

  /** Hard delete — cascades to hh_invoice_lines via FK. */
  deleteInvoice(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(INVOICES, id, `${SCOPE}.deleteInvoice`, opts);
  },

  /** Atomic delete + receipt detach + sequence compact (Postgres RPC). */
  deleteInvoiceRpc(
    invoiceId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<
    ApiResult<{
      ok: boolean;
      invoice_no?: string;
      billing_id?: string;
      receipts_detached?: number;
      code?: string;
      message?: string;
    } | null>
  > {
    return callRpc(
      "hominal_delete_invoice",
      { p_invoice_id: invoiceId, p_actor: actor },
      `${SCOPE}.deleteInvoiceRpc`,
      opts
    );
  },

  /** Detach receipts from an invoice (set invoice_id = null). */
  async detachReceiptsFromInvoice(
    invoiceId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .update({ invoice_id: null, updated_by: actor })
          .eq("invoice_id", invoiceId)
          .select("id"),
      `${SCOPE}.detachReceiptsFromInvoice`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /** Compact the invoice number sequence — call after every invoice delete. */
  compactInvoiceSeqRpc(opts?: DbAccess): Promise<ApiResult<number | null>> {
    return callRpc<number>("hh_compact_invoice_seq", {}, `${SCOPE}.compactInvoiceSeqRpc`, opts);
  },

  listInvoiceLines(invoiceId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(INVOICE_LINES, SCOPE, (q) => q.eq("invoice_id", invoiceId), {
      ...opts,
      orderBy: "date",
      ascending: true
    });
  },

  async removeInvoiceLinesByInvoice(
    invoiceId: string,
    opts?: DbAccess
  ): Promise<ApiResult<null>> {
    const db = resolveClient(opts);
    const result = await runQuery(
      () => db.from(INVOICE_LINES).delete().eq("invoice_id", invoiceId),
      `${SCOPE}.removeInvoiceLinesByInvoice`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: null };
  },

  /** Active (non-soft-deleted) receipts attached to an invoice. */
  listReceiptsByInvoice(
    invoiceId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .select("*")
          .eq("invoice_id", invoiceId)
          .is("deleted_at", null)
          .order("date", { ascending: true }),
      `${SCOPE}.listReceiptsByInvoice`
    );
  },

  /** Bundle read for invoice screen — no totals (business layer computes). */
  async loadBillingBundle(
    billingId: string,
    opts?: DbAccess
  ): Promise<
    ApiResult<{
      billing: JsonRow | null;
      receipts: JsonRow[];
      services: JsonRow[];
    }>
  > {
    const [billing, receipts, services] = await Promise.all([
      billingRepository.findBillingById(billingId, opts),
      billingRepository.listReceiptsByBilling(billingId, opts),
      billingRepository.listSvcByBilling(billingId, opts)
    ]);
    if (!billing.success) {
      return { success: false, error: billing.error, code: billing.code, details: billing.details };
    }
    if (!receipts.success) {
      return { success: false, error: receipts.error, code: receipts.code, details: receipts.details };
    }
    if (!services.success) {
      return { success: false, error: services.error, code: services.code, details: services.details };
    }
    return {
      success: true,
      data: {
        billing: billing.data ?? null,
        receipts: receipts.data || [],
        services: services.data || []
      }
    };
  }
};
