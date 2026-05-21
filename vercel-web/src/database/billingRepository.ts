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

const BILLINGS = "hh_billings";
const RECEIPTS = "hh_receipts";
const SVC = "hh_svc_entries";
const INVOICES = "hh_invoices";
const INVOICE_ITEMS = "hh_invoice_items";
const BILLING_RECEIPTS = "hh_billing_receipts";
const SCOPE = "billingRepository";

export interface BillingListFilters extends ListQuery {
  patient_id?: string;
  status?: string;
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

  listBillings(filters: BillingListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      BILLINGS,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.patient_id) query = query.eq("patient_id", filters.patient_id);
        if (filters.status) query = query.eq("status", filters.status);
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
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

  updateBilling(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(BILLINGS, id, patch, SCOPE, opts);
  },

  removeBilling(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(BILLINGS, id, SCOPE, opts);
  },

  // --- Receipts ---

  findReceiptById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(RECEIPTS, id, SCOPE, opts);
  },

  listReceiptsByBilling(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(RECEIPTS, SCOPE, (q) => q.eq("billing_id", billingId), {
      ...opts,
      orderBy: "date",
      ascending: true
    });
  },

  listAllReceipts(opts?: DbAccess & { orderBy?: string }): Promise<ApiResult<JsonRow[]>> {
    return listAll(RECEIPTS, SCOPE, (q) => q, {
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

  insertSvc(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(SVC, row, `${SCOPE}.insertSvc`, opts);
  },

  updateSvc(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(SVC, id, patch, `${SCOPE}.updateSvc`, opts);
  },

  removeSvc(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(SVC, id, `${SCOPE}.removeSvc`, opts);
  },

  // --- Invoices (Phase 4 ledger) ---

  findInvoiceById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(INVOICES, id, SCOPE, opts);
  },

  listInvoiceItems(invoiceId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(INVOICE_ITEMS, SCOPE, (q) => q.eq("invoice_id", invoiceId), opts);
  },

  listBillingReceiptLinks(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(BILLING_RECEIPTS, SCOPE, (q) => q.eq("billing_id", billingId), opts);
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
