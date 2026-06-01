import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import {
  canEditBilling,
  canGenerateFinalInvoice,
  canReceiveAgainst,
  invoiceOutstanding,
  type BillingTotals,
  type InvoiceRowLike
} from "@/business/billingRules";

export { canReceiveAgainst, canReceiveOnBilling } from "@/business/billingRules";

/** New invoices / svc edits require an open (non-closed) bill. */
export function canIssueInvoice(billingStatus: string | null | undefined): ApiResult<null> {
  return canEditBilling(billingStatus);
}

/** Receipt soft-delete follows the same lock as svc / invoice issuance. */
export function canSoftDeleteReceipt(billingStatus: string | null | undefined): ApiResult<null> {
  return canEditBilling(billingStatus);
}

/**
 * Invoice cancellation is allowed on Closed bills (recovery: remove a mistaken
 * MONTHLY) but not on Cancelled terminal bills.
 */
export function canCancelInvoice(billingStatus: string | null | undefined): ApiResult<null> {
  if (String(billingStatus || "") === "Cancelled") {
    return businessFailure("Bill is Cancelled — cannot delete invoices", { status: billingStatus });
  }
  return businessOk();
}

/** Hard-delete (cancel) invoice — PAID rows must be voided in Node first. */
export function canDeleteInvoice(invoiceStatus: string | null | undefined): ApiResult<null> {
  const status = String(invoiceStatus || "").toUpperCase();
  if (status === "PAID") {
    return businessFailure("Cannot delete a PAID invoice — void receipts first", { status });
  }
  return businessOk();
}

export function assertInvoiceBelongsToBilling(
  invoiceBillingId: string | null | undefined,
  billingId: string
): ApiResult<null> {
  if (String(invoiceBillingId || "") !== billingId) {
    return businessFailure("Invoice does not belong to this bill", {
      invoice_billing_id: invoiceBillingId,
      billing_id: billingId
    });
  }
  return businessOk();
}

export interface CanRegenerateInvoiceInput {
  kind: string | null | undefined;
  period: string | null | undefined;
  receivedOnInvoice: number;
}

export function canRegenerateInvoice(input: CanRegenerateInvoiceInput): ApiResult<null> {
  if (String(input.kind || "") !== "MONTHLY" || !input.period) {
    return businessFailure(
      "Only MONTHLY invoices can be regenerated from service entries",
      { kind: input.kind }
    );
  }
  if (Number(input.receivedOnInvoice || 0) > 0) {
    return businessFailure(
      "Cannot regenerate an invoice that already has receipts — delete receipts first",
      { received: input.receivedOnInvoice }
    );
  }
  return businessOk();
}

export interface AssertFinalInvoiceInput {
  billingStatus: string;
  invoices: InvoiceRowLike[];
  servicesTotal: number;
  secDep: number;
}

/** Gate before `hominal_generate_final_invoice` RPC. */
export function assertCanGenerateFinalInvoice(input: AssertFinalInvoiceInput): ApiResult<null> {
  return canGenerateFinalInvoice({
    billingStatus: input.billingStatus,
    invoices: input.invoices,
    servicesTotal: input.servicesTotal,
    secDep: input.secDep
  });
}

export interface ReceiptInvoiceContextInput {
  billingStatus: string;
  totals: BillingTotals;
  amount: number;
  invoiceId?: string | null;
  invoiceAmount?: number | null;
  invoiceReceived?: number | null;
}

/**
 * Validate receipt amount against bill + optional invoice caps.
 * Loads invoice outstanding when invoiceAmount/invoiceReceived provided.
 */
export function assertCanRecordReceipt(input: ReceiptInvoiceContextInput): ApiResult<null> {
  let invoiceOutstandingAmount: number | undefined;
  if (input.invoiceId && input.invoiceAmount != null && input.invoiceReceived != null) {
    invoiceOutstandingAmount = invoiceOutstanding(
      Number(input.invoiceAmount),
      Number(input.invoiceReceived)
    );
  }
  return canReceiveAgainst({
    billingStatus: input.billingStatus,
    totals: input.totals,
    amount: input.amount,
    invoiceId: input.invoiceId,
    invoiceOutstanding: invoiceOutstandingAmount
  });
}
