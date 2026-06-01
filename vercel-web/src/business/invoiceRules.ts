import {
  invoiceOutstanding,
  type BillingPaidStatus
} from "@/business/billingRules";
import type { InvoicePaidStatusDto } from "@/validation/billingDto";

export type { BillingTotals, BillingLine } from "@/business/billingRules";
export { computeBillingTotals, sumServiceTotals, sumReceiptAmounts } from "@/business/billingRules";

// ───────────────────────────────────────────────────────────────────────────
// Row shapes (minimal — works with JsonRow from repositories)
// ───────────────────────────────────────────────────────────────────────────

export interface InvoiceRowLike {
  id?: string | null;
  status?: string | null;
  amount?: number | string | null;
  kind?: string | null;
  period?: string | null;
  invoice_no?: string | null;
  created_at?: string | null;
  from_date?: string | null;
}

export interface ReceiptRowLike {
  invoice_id?: string | null;
  amount?: number | string | null;
}

export interface InvoiceSummaryView {
  invoice: InvoiceRowLike;
  amount: number;
  received: number;
  outstanding: number;
  status: InvoicePaidStatusDto;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-invoice status (single source of truth)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-invoice paid status for display and persistence.
 *
 * - persisted CANCELLED → CANCELLED
 * - amount == 0         → PAID (closing / no-op doc)
 * - received >= amount  → PAID
 * - 0 < received      → PARTIAL
 * - else                → UNPAID
 */
export function derivePerInvoiceStatus(
  persisted: string,
  amount: number,
  received: number,
  _outstanding?: number
): InvoicePaidStatusDto {
  const upper = String(persisted || "").toUpperCase();
  if (upper === "CANCELLED") return "CANCELLED";
  if (amount <= 0) return "PAID";
  if (received >= amount) return "PAID";
  if (received > 0) return "PARTIAL";
  return "UNPAID";
}

/** Map view status to persisted hh_invoices.status (excludes CANCELLED). */
export function invoiceStatusForPersistence(
  status: InvoicePaidStatusDto
): BillingPaidStatus | "CANCELLED" {
  if (status === "CANCELLED") return "CANCELLED";
  return status;
}

// ───────────────────────────────────────────────────────────────────────────
// Deposit overflow redistribution (view layer only)
// ───────────────────────────────────────────────────────────────────────────

/**
 * FINAL invoices at ₹0 can carry deposit receipts. Redistribute overflow
 * onto older unpaid siblings so per-invoice outstanding sums match bill-level
 * outstanding. DB rows are untouched.
 */
export function redistributeDepositOverflow(
  invoiceRows: InvoiceRowLike[],
  receiptsByInvoice: Map<string, number>
): void {
  const activeInvoices = invoiceRows.filter(
    (inv) => String(inv.status || "").toUpperCase() !== "CANCELLED"
  );

  const overflow = new Map<string, number>();
  for (const inv of activeInvoices) {
    const id = String(inv.id);
    const amount = Number(inv.amount || 0);
    const rawReceived = Number(receiptsByInvoice.get(id) || 0);
    const over = rawReceived - Math.max(0, amount);
    if (over > 0) overflow.set(id, over);
  }

  if (overflow.size === 0) return;

  const sortKey = (inv: InvoiceRowLike): string =>
    String(inv.created_at || inv.from_date || inv.period || inv.id || "");
  const unpaidTargets = activeInvoices
    .filter((inv) => !overflow.has(String(inv.id)))
    .slice()
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  overflow.forEach((overAmount, sourceId) => {
    let remaining = overAmount;
    for (const target of unpaidTargets) {
      if (remaining <= 0) break;
      const tid = String(target.id);
      const tAmount = Number(target.amount || 0);
      if (tAmount <= 0) continue;
      const tReceived = Number(receiptsByInvoice.get(tid) || 0);
      const room = tAmount - tReceived;
      if (room <= 0) continue;
      const apply = Math.min(room, remaining);
      receiptsByInvoice.set(tid, tReceived + apply);
      remaining -= apply;
    }
    const sourceReceived = Number(receiptsByInvoice.get(sourceId) || 0);
    receiptsByInvoice.set(sourceId, sourceReceived - (overAmount - remaining));
  });
}

/** Build invoice table rows with received / outstanding / status. */
export function buildInvoiceSummaries(
  invoiceRows: InvoiceRowLike[],
  receipts: ReceiptRowLike[]
): InvoiceSummaryView[] {
  const receiptsByInvoice = new Map<string, number>();
  for (const r of receipts) {
    const invId = String(r.invoice_id || "");
    if (!invId) continue;
    receiptsByInvoice.set(
      invId,
      Number(receiptsByInvoice.get(invId) || 0) + Number(r.amount || 0)
    );
  }

  redistributeDepositOverflow(invoiceRows, receiptsByInvoice);

  const activeInvoices = invoiceRows.filter(
    (inv) => String(inv.status || "").toUpperCase() !== "CANCELLED"
  );

  return activeInvoices.map((inv) => {
    const id = String(inv.id);
    const amount = Number(inv.amount || 0);
    const received = Number(receiptsByInvoice.get(id) || 0);
    const outstanding = invoiceOutstanding(amount, received);
    const persisted = String(inv.status || "").toUpperCase();
    const status = derivePerInvoiceStatus(persisted, amount, received, outstanding);
    return { invoice: inv, amount, received, outstanding, status };
  });
}
