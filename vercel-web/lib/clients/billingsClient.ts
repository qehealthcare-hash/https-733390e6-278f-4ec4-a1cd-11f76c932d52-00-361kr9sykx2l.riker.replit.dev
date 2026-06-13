import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const BILLINGS_BASE = "/billings";

function billingPath(id: string, suffix = "") {
  return BILLINGS_BASE + "/" + encodeURIComponent(id) + suffix;
}

function freshInvoiceIdempotencyKey() {
  return "invoice-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

export const billingsClient = {
  basePath: BILLINGS_BASE,

  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(BILLINGS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(billingPath(id), null, session);
  },

  create(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(BILLINGS_BASE, { method: "POST", body }, session);
  },

  patch(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(billingPath(id), { method: "PATCH", body }, session);
  },

  listForPatient(session: ApiSession, patientId: string) {
    return request(withQuery(BILLINGS_BASE, { patient_id: patientId }), null, session);
  },

  createInvoice(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/invoices"),
      {
        method: "POST",
        body,
        headers: { "Idempotency-Key": freshInvoiceIdempotencyKey() }
      },
      session
    );
  },

  getInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return request(billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId)), null, session);
  },

  deleteInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId)),
      { method: "DELETE" },
      session
    );
  },

  regenerateInvoice(session: ApiSession, billingId: string, invoiceId: string) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/invoices/" + encodeURIComponent(invoiceId) + "/regenerate"),
      { method: "POST" },
      session
    );
  },

  generateFinalInvoice(session: ApiSession, billingId: string, body: Record<string, unknown> = {}) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/invoices/final"),
      { method: "POST", body },
      session
    );
  },

  createReceipt(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/receipts"),
      { method: "POST", body },
      session
    );
  },

  setStatus(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/status"),
      { method: "POST", body },
      session
    );
  },

  close(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/close"),
      { method: "POST", body },
      session
    );
  },

  reopen(session: ApiSession, billingId: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(
      billingPath(billingId, "/reopen"),
      { method: "POST", body },
      session
    );
  },

  /** Materialize billable duties → Active bill svc_entries (calendar/billing parity). */
  syncDutyLedger(session: ApiSession, patientId: string) {
    return requestWithOfflineFallback(
      BILLINGS_BASE + "/duty-ledger-sync",
      { method: "POST", body: { patient_id: patientId } },
      session
    );
  },

  /** Live duty-calendar billing ledger for desync checks. */
  patientDutyLedger(session: ApiSession, patientId: string, period: string) {
    return request(
      withQuery(BILLINGS_BASE + "/ledger", { patient_id: patientId, period }),
      null,
      session
    );
  }
};
