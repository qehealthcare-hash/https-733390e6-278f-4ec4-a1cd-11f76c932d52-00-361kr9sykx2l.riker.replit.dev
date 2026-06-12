/**
 * Billing module UI helpers — pure utilities and read-model shapes for the ledger page.
 */

import type {
  BillingPermissionsDto,
  BillingSummaryDto,
  BillingTotalsDto,
  InvoiceSummaryDto,
  ReceiptRowDto
} from "@/validation/billingDto";

export const BILLING_LIST_LIMIT = 100;

export type BillingBundle = BillingSummaryDto & {
  billing: BillingSummaryDto["billing"] & {
    created?: string;
    patient_id?: string;
  };
};

/** Optimistic-lock token from the loaded billing row (`updated_at`). */
export function billingExpectedUpdatedAt(
  bundle: BillingBundle | null | undefined
): string {
  return String(bundle?.billing?.updated_at || "").trim();
}

export { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";

export interface BillingListRow {
  id: string;
  patient_id?: string;
  patient_name?: string;
  patient_phone?: string;
  invoice_no?: string;
  status?: string;
  paid_status?: string;
  sec_dep?: number;
  created_at?: string;
  created?: string;
  totals?: { outstanding?: number };
}

export interface BillingListEnvelope {
  rows?: BillingListRow[];
  total?: number;
}

export interface ReceiptFormState {
  billing_id: string;
  invoice_id: string;
  type: string;
  method: string;
  amount: string;
  date: string;
  ref: string;
  remarks: string;
}

export interface SecDepFormState {
  sec_dep: number | string;
}

export interface ManualInvoiceLine {
  date: string;
  service_name: string;
  partner: string;
  count: number;
  amt: number;
  total: number;
}

export interface PatientLookupRow {
  id: string;
  name?: string;
  full_name?: string;
  mobile?: string;
}

export interface ServiceLineRow {
  id?: string;
  svc_key?: string;
  date?: string;
  service_name?: string;
  partner?: string;
  count?: number;
  amt?: number;
  total?: number;
}

export interface InvoiceLineRow {
  service_name?: string;
  partner?: string;
  count?: number;
  amt?: number;
  total?: number;
  date?: string;
}

export interface InvoiceGroupSummary {
  service_name: string;
  rate: number;
  days: number;
  total: number;
  from?: string;
  to?: string;
}

export interface InvoiceLinesSummary {
  groups: InvoiceGroupSummary[];
  partners: string[];
}

export interface BundleTotalsView {
  billed: number;
  receipts: number;
  outstanding: number;
  sec_dep: number;
}

export type MonthOption = { value: string; label: string };

export function monthOptions(count: number): MonthOption[] {
  const now = new Date();
  const out: MonthOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({
      value: y + "-" + m,
      label: d.toLocaleString("en-IN", { month: "long", year: "numeric" })
    });
  }
  return out;
}

export function amountWords(amount: number | string | null | undefined): string {
  let n = Math.round(Number(amount || 0));
  if (!Number.isFinite(n) || n <= 0) return "Zero";
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function chunk(num: number): string {
    if (num === 0) return "";
    if (num < 20) return a[num] || "";
    if (num < 100) {
      return (b[Math.floor(num / 10)] || "") + (num % 10 ? " " + (a[num % 10] || "") : "");
    }
    return (a[Math.floor(num / 100)] || "") + " Hundred" + (num % 100 ? " " + chunk(num % 100) : "");
  }
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const rest = n;
  const parts: string[] = [];
  if (crore) parts.push(chunk(crore) + " Crore");
  if (lakh) parts.push(chunk(lakh) + " Lakh");
  if (thousand) parts.push(chunk(thousand) + " Thousand");
  if (rest) parts.push(chunk(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function emptyReceiptForm(billingId?: string): ReceiptFormState {
  return {
    billing_id: billingId || "",
    invoice_id: "",
    type: "Advance",
    method: "Cash",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    ref: "",
    remarks: ""
  };
}

export function emptySecDepForm(): SecDepFormState {
  return { sec_dep: 0 };
}

export function defaultManualLine(): ManualInvoiceLine {
  return {
    date: new Date().toISOString().slice(0, 10),
    service_name: "Care Taker Services",
    partner: "",
    count: 1,
    amt: 750,
    total: 750
  };
}

export function totalsFromBundle(bundle: BillingBundle | null | undefined): BundleTotalsView {
  if (!bundle?.totals) {
    return { billed: 0, receipts: 0, outstanding: 0, sec_dep: 0 };
  }
  const totals = bundle.totals as BillingTotalsDto & { billed?: number };
  const billed = Number(
    (totals.services != null ? totals.services : totals.billed) || 0
  );
  return {
    billed,
    receipts: Number(totals.receipts || 0),
    outstanding: Number(totals.outstanding || 0),
    sec_dep: Number(totals.sec_dep || 0)
  };
}

export function defaultBillingPermissions(): BillingPermissionsDto {
  return {
    canEdit: false,
    canReceive: false,
    canGenerateFinal: false,
    canClose: false,
    canReopen: false
  };
}

export function summarizeInvoiceLines(
  lines: InvoiceLineRow[] | null | undefined,
  employeeNameById: Record<string, string>
): InvoiceLinesSummary {
  const map = new Map<string, InvoiceGroupSummary>();
  const partnerSet = new Set<string>();
  const datesByGroup = new Map<string, string[]>();
  (lines || []).forEach(function (l) {
    const rate = Number(l.amt || 0);
    const name = String(l.service_name || "Service");
    const count = Number(l.count || 1);
    const total = Number(l.total != null ? l.total : rate * count);
    const key = name + "||" + rate;
    const existing = map.get(key);
    if (existing) {
      existing.days += count;
      existing.total += total;
    } else {
      map.set(key, { service_name: name, rate, days: count, total });
    }
    if (l.partner) partnerSet.add(String(l.partner));
    const dlist = datesByGroup.get(key) || [];
    if (l.date) dlist.push(String(l.date).slice(0, 10));
    datesByGroup.set(key, dlist);
  });
  const groups = Array.from(map.values()).sort(function (a, b) {
    return a.service_name.localeCompare(b.service_name) || a.rate - b.rate;
  });
  groups.forEach(function (g) {
    const d = datesByGroup.get(g.service_name + "||" + g.rate) || [];
    d.sort();
    if (d.length) {
      g.from = d[0];
      g.to = d[d.length - 1];
    }
  });
  const partners = Array.from(partnerSet).map(function (pid) {
    const name = employeeNameById[pid];
    return name && name !== pid ? name : pid;
  });
  return { groups, partners };
}

export function findInvoiceSummary(
  invoices: InvoiceSummaryDto[] | undefined,
  invoiceId: string
): InvoiceSummaryDto | undefined {
  return (invoices || []).find(function (row) {
    return String(row.invoice && row.invoice.id) === String(invoiceId);
  });
}

export function receiptInvoiceLabel(
  receipt: ReceiptRowDto,
  invoices: InvoiceSummaryDto[] | undefined
): string {
  if (!receipt.invoice_id || !invoices) return "-";
  const match = findInvoiceSummary(invoices, String(receipt.invoice_id));
  if (match && match.invoice) {
    return match.invoice.invoice_no || match.invoice.id;
  }
  return "-";
}
