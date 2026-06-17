import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  billingListResponseDtoSchema,
  billingListRowDtoSchema,
  billingPatientHistoryDtoSchema,
  billingRowDtoSchema,
  billingSummaryDtoSchema,
  billingTotalsDtoSchema,
  cancelInvoiceResultDtoSchema,
  dutyLedgerSyncSummaryDtoSchema,
  finalInvoiceResultDtoSchema,
  generateInvoiceResultDtoSchema,
  invoiceDetailDtoSchema,
  invoiceSummaryDtoSchema,
  patientDutyLedgerDtoSchema,
  receiptOrNullDtoSchema,
  receiptRowDtoSchema,
  regenerateInvoiceResultDtoSchema,
} from "@/validation/billingDto";


export const BILLINGS_BASE = "/billings";

function billingPath(id: string, suffix = "") {
  return BILLINGS_BASE + "/" + encodeURIComponent(id) + suffix;
}

function freshInvoiceIdempotencyKey() {
  return "invoice-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

export const billingsClient = {
  basePath: BILLINGS_BASE,

  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    const query = params || {};
    const patientId = query.patient_id != null ? String(query.patient_id) : "";
    const wantsHistoryBundle =
      Boolean(patientId) &&
      (String(query.bundle || "") === "1" ||
        (query.limit == null &&
          query.offset == null &&
          query.q == null &&
          query.status == null &&
          query.period == null));
    const path = withQuery(BILLINGS_BASE, params);
    if (patientId && wantsHistoryBundle) {
      return requestValidated(path, null, session, billingPatientHistoryDtoSchema, {
        kind: "billing_history",
        scope: "GET /billings?patient_id",
        billings: billingRowDtoSchema,
        receipts: receiptRowDtoSchema,
        invoices: invoiceSummaryDtoSchema,
        totals: billingTotalsDtoSchema
      });
    }
    return requestValidated(path, null, session, billingListResponseDtoSchema, {
      kind: "list",
      list: { rowSchema: billingListRowDtoSchema, scope: "GET /billings", idField: "id" }
    });
  },

  get(session: ApiSession, id: string) {
    return requestValidated(billingPath(id), null, session, billingSummaryDtoSchema);
  },

  create(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(BILLINGS_BASE, { method: "POST", body }, session, billingRowDtoSchema);
  },

  patch(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(billingPath(id), { method: "PATCH", body }, session, billingRowDtoSchema);
  },

  listForPatient(session: ApiSession, patientId: string) {
    return requestValidated(
      withQuery(BILLINGS_BASE, { patient_id: patientId }),
      null,
      session,
      billingPatientHistoryDtoSchema
    );
  },

  createInvoice(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/invoices"),
      {
        method: "POST",
        body,
        headers: { "Idempotency-Key": freshInvoiceIdempotencyKey() }
      },
      session,
      generateInvoiceResultDtoSchema
    );
  },

  getInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return requestValidated(
      billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId)),
      null,
      session,
      invoiceDetailDtoSchema
    );
  },

  deleteInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId)),
      { method: "DELETE" },
      session,
      cancelInvoiceResultDtoSchema
    );
  },

  regenerateInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId) + "/regenerate"),
      { method: "POST" },
      session,
      regenerateInvoiceResultDtoSchema
    );
  },

  generateFinalInvoice(
    session: ApiSession,
    billingId: string,
    body: Record<string, unknown> = {}
  ) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/invoices/final"),
      { method: "POST", body },
      session,
      finalInvoiceResultDtoSchema
    );
  },

  createReceipt(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/receipts"),
      { method: "POST", body },
      session,
      receiptOrNullDtoSchema
    );
  },

  setStatus(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/status"),
      { method: "POST", body },
      session,
      billingRowDtoSchema
    );
  },

  close(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/close"),
      { method: "POST", body },
      session,
      billingSummaryDtoSchema
    );
  },

  reopen(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      billingPath(billingId, "/reopen"),
      { method: "POST", body },
      session,
      billingSummaryDtoSchema
    );
  },

  /** Materialize billable duties → Active bill svc_entries (calendar/billing parity). */
  syncDutyLedger(session: ApiSession, patientId: string) {
    return requestValidatedWithOfflineFallback(
      BILLINGS_BASE + "/duty-ledger-sync",
      { method: "POST", body: { patient_id: patientId } },
      session,
      dutyLedgerSyncSummaryDtoSchema
    );
  },

  /** Live duty-calendar billing ledger for desync checks. */
  patientDutyLedger(session: ApiSession, patientId: string, period: string) {
    return requestValidated(
      withQuery(BILLINGS_BASE + "/ledger", { patient_id: patientId, period }),
      null,
      session,
      patientDutyLedgerDtoSchema
    );
  }
};
