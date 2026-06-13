"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { confirmDiscardTyped } from "@/lib/modalDiscard";
import { useBusyGuard } from "@/hooks/use-busy-guard";
import { useAuth } from "@/components/providers/auth-provider";
import { billingsClient, lookupsClient } from "@/lib/clients";
import {
  billingStatusOptions,
  closeReasonOptions,
  paymentMethodOptions,
  receiptTypeOptions
} from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { crmTodayIso } from "@/src/utils/crmToday";
import { ledgerBackdatedDateMax } from "@/lib/dateFieldBounds";
import {
  openPrintWindow,
  preOpenPrintWindow,
  reportPrintBlocked,
  writePrintWindowMessage
} from "@/lib/print";
import {
  BILLING_LIST_LIMIT,
  amountWords,
  defaultBillingPermissions,
  defaultManualLine,
  emptyReceiptForm,
  emptySecDepForm,
  monthOptions,
  summarizeInvoiceLines,
  totalsFromBundle,
  apiErrorMessage,
  billingExpectedUpdatedAt,
  isApiConflictError,
  type BillingBundle,
  type BillingListEnvelope,
  type BillingListRow,
  type ManualInvoiceLine,
  type MonthOption,
  type PatientLookupRow,
  type ReceiptFormState,
  type SecDepFormState,
  type ServiceLineRow
} from "@/lib/billingUi";
import type {
  BillingPermissionsDto,
  InvoiceRowDto,
  PatientSnapshotDto,
  ReceiptRowDto
} from "@/validation/billingDto";
import {
  DESYNC_ALERT_HEADLINE,
  DUTY_LEDGER_READONLY_MESSAGE,
  detectLedgerDesync
} from "@/lib/dutyLedgerUi";

type BillingsAuth = {
  session?: { access_token?: string } | null;
  supabase?: {
    channel: (name: string) => {
      on: (
        event: string,
        filter: { event: string; schema: string; table: string },
        handler: () => void
      ) => { on: (...args: unknown[]) => unknown; subscribe: () => void };
      subscribe: () => void;
    };
    removeChannel: (channel: unknown) => void;
  };
};

function paidStatusBadge(status: string | null | undefined) {
  const label = String(status || "UNPAID").toUpperCase();
  let color = "#94a3b8";
  if (label === "PAID") color = "#16a34a";
  else if (label === "PARTIAL") color = "#f59e0b";
  else if (label === "UNPAID") color = "#dc2626";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: color,
        color: "#fff",
        marginLeft: 8
      }}
    >
      {label}
    </span>
  );
}

function currentBillingMonth(): string {
  return crmTodayIso().slice(0, 7);
}

function monthLabel(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period || "-";
  const parts = period.split("-");
  const y = Number(parts[0] || 0);
  const m = Number(parts[1] || 1) - 1;
  return new Date(y, m, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

export default function BillingsPage() {
  const auth = useAuth() as unknown as BillingsAuth;
  const accessToken = auth.session?.access_token;
  const supabaseRef = useRef(auth.supabase);
  supabaseRef.current = auth.supabase;
  const [billings, setBillings] = useState<BillingListRow[]>([]);
  // P1-28: track the API limit + the server's total so we can surface a
  // "Showing first N of M — refine filters" banner when the list is capped.
  // Previously a clinic with > 100 active bills only ever saw the first 100
  // and there was zero indication of truncation.
  // BILLING_LIST_LIMIT from billingUi
  const [billingsTotal, setBillingsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  // Centralized toast mirror — pages keep their inline banner (legacy UX)
  // and ALSO get a non-blocking toast so users see feedback even when the
  // banner is scrolled out of view. Empty strings clear without toasting.
  const toast = useToast();
  const confirm = useConfirm();
  const [closeBillDialog, setCloseBillDialog] = useState<{ reason: string } | null>(null);
  const [reopenBillDialog, setReopenBillDialog] = useState<{ reason: string } | null>(null);
  const setError = useCallback(function (msg: string) {
    const text = String(msg || "");
    setErrorState(text);
    if (text) toast.error(text);
  }, [toast]);
  const setMessage = useCallback(function (msg: string) {
    const text = String(msg || "");
    setMessageState(text);
    if (text) toast.success(text);
  }, [toast]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientLookupRow[]>([]);
  const [employeeNameById, setEmployeeNameById] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState("");
  const [bundle, setBundle] = useState<BillingBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptFormState>(emptyReceiptForm());
  const [secDepForm, setSecDepForm] = useState<SecDepFormState>(emptySecDepForm());
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [conflictPrompt, setConflictPrompt] = useState<{ message: string } | null>(null);
  const [createPatientId, setCreatePatientId] = useState("");
  const [createSecDep, setCreateSecDep] = useState<number | string>(0);
  const [dutyLedger, setDutyLedger] = useState<{
    billed: number;
    duty_count: number;
  } | null>(null);
  const { busy, tryBegin, end } = useBusyGuard();

  async function reloadList() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      const data = (await billingsClient.list(auth.session, {
        limit: BILLING_LIST_LIMIT,
        status: statusFilter || undefined,
        q: search.trim() || undefined
      })) as
        | BillingListEnvelope
        | BillingListRow[];
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      setBillings(rows);
      setBillingsTotal(
        Number(!Array.isArray(data) && data?.total != null ? data.total : rows.length) ||
          rows.length
      );
      setError("");
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Failed to load bills");
      setBillings([]);
      setBillingsTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function openBilling(id: string) {
    if (!id) {
      setBundle(null);
      setSelectedId("");
      setExpectedUpdatedAt("");
      setConflictPrompt(null);
      return;
    }
    setBundleLoading(true);
    setError("");
    setConflictPrompt(null);
    try {
      const data = (await billingsClient.get(auth.session, id)) as BillingBundle;
      setBundle(data);
      setSelectedId(id);
      setReceiptForm(emptyReceiptForm(id));
      setSecDepForm({ sec_dep: Number(data?.billing?.sec_dep ?? 0) });
      setServiceViewPeriod(function (prev) {
        return selectedId === id && prev ? prev : currentBillingMonth();
      });
      const version = billingExpectedUpdatedAt(data);
      setExpectedUpdatedAt(version);
      if (data?.billing?.id && !version) {
        setMessage(
          "Loaded a legacy bill without a last-modified timestamp — concurrent edit detection is disabled for this record."
        );
      }
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not load bill detail");
      setBundle(null);
    } finally {
      setBundleLoading(false);
    }
  }

  useEffect(
    function () {
      if (!accessToken) return;
      reloadList();
      lookupsClient
        .patients(auth.session)
        .then(function (rows) {
          setPatients(Array.isArray(rows) ? rows : []);
        })
        .catch(function () {
          setPatients([]);
        });
      lookupsClient
        .employees(auth.session)
        .then(function (rows) {
          const arr = Array.isArray(rows)
            ? rows
            : (rows as { rows?: { id: string; name?: string; full_name?: string }[] })?.rows ||
              (rows as { data?: { id: string; name?: string; full_name?: string }[] })?.data ||
              [];
          const map: Record<string, string> = {};
          arr.forEach(function (e) {
            map[e.id] = e.name || e.full_name || e.id;
          });
          setEmployeeNameById(map);
        })
        .catch(function () { setEmployeeNameById({}); });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, statusFilter]
  );

  useEffect(
    function () {
      const supabase = supabaseRef.current;
      if (!accessToken || !supabase) return undefined;
      const channel = supabase.channel("crm-billing-ledger");
      ["hh_billings", "hh_invoices", "hh_receipts", "hh_svc_entries"].forEach(function (table) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: table },
          function () {
            reloadList();
            if (selectedId) openBilling(selectedId);
          }
        );
      });
      channel.subscribe();
      return function () {
        supabase.removeChannel(channel);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, selectedId]
  );

  const filtered = useMemo(
    function () {
      if (!search.trim()) return billings;
      const needle = search.trim().toLowerCase();
      return billings.filter(function (row) {
        return (
          String(row.id || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.invoice_no || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_id || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_name || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_phone || "").toLowerCase().indexOf(needle) >= 0
        );
      });
    },
    [billings, search]
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createPatientId) return;
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    try {
      const data = await billingsClient.create(auth.session, {
        patient_id: createPatientId,
        sec_dep: Number(createSecDep || 0)
      });
      setMessage("Bill created for patient " + createPatientId);
      setCreatePatientId("");
      setCreateSecDep(0);
      await reloadList();
      if (data?.id) await openBilling(data.id);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not create bill");
    } finally {
      end();
    }
  }

  function noteBillingConflict(err: unknown): boolean {
    if (!isApiConflictError(err)) return false;
    setConflictPrompt({
      message: apiErrorMessage(err, "Bill was modified by another user.")
    });
    setError(apiErrorMessage(err, "Bill was modified by another user."));
    return true;
  }

  async function reloadBillingFromConflict() {
    if (!selectedId) {
      setConflictPrompt(null);
      return;
    }
    if (!tryBegin()) return;
    try {
      await openBilling(selectedId);
      setConflictPrompt(null);
      setMessage("Bill reloaded — your previous edits were discarded.");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not reload bill"));
    } finally {
      end();
    }
  }

  async function handleSecDepSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    if (!tryBegin()) return;
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = {
        sec_dep: Number(secDepForm.sec_dep || 0)
      };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await billingsClient.patch(auth.session, selectedId, payload);
      setMessage("Security deposit updated");
      await openBilling(selectedId);
      await reloadList();
    } catch (err: unknown) {
      if (!noteBillingConflict(err)) {
        setError(apiErrorMessage(err, "Could not update security deposit"));
      }
    } finally {
      end();
    }
  }

  async function handleGenerateInvoice(kind: string, period?: string) {
    if (!selectedId) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const body: { kind: string; period?: string } = { kind };
      if (kind === "MONTHLY") body.period = period;
      const data = await billingsClient.createInvoice(auth.session, selectedId, body);
      const note = data && data.duplicate
        ? "Invoice for " + period + " already exists — opened existing"
        : "Invoice generated";
      setMessage(note);
      void openBilling(selectedId);
      void reloadList();
      return data && data.invoice ? data.invoice : null;
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not generate invoice");
      return null;
    } finally {
      end();
    }
  }

  async function handleDeleteInvoice(invoiceId: string, invoiceLabel?: string) {
    if (!selectedId || !invoiceId) return;
    const ok = await confirm({
      title: "Delete invoice?",
      description:
        "Delete invoice " +
        (invoiceLabel || invoiceId) +
        " permanently? It will be removed from the ledger and any receipts already recorded against it become on-account credit on the bill.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const data = await billingsClient.deleteInvoice(auth.session, selectedId, invoiceId);
      const detached = data && data.receipts_detached ? data.receipts_detached : 0;
      setMessage(
        "Invoice deleted" +
          (detached ? " · " + detached + " receipt(s) returned to on-account" : "")
      );
      await openBilling(selectedId);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not delete invoice");
    } finally {
      end();
    }
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    if (billingDesyncDetected) {
      setError(DESYNC_ALERT_HEADLINE + " Sync duty ledger from the Duty Calendar before recording receipts.");
      return;
    }
    if (!tryBegin()) return;
    setError("");
    try {
      await billingsClient.createReceipt(auth.session, selectedId, {
        billing_id: selectedId,
        patient_id:
          (bundle && bundle.billing && bundle.billing.patient_id) ||
          (bundle && bundle.patient && bundle.patient.id) ||
          "",
        invoice_id: receiptForm.invoice_id || null,
        type: receiptForm.type,
        method: receiptForm.method,
        amount: Number(receiptForm.amount || 0),
        date: receiptForm.date,
        ref: receiptForm.ref || "",
        remarks: receiptForm.remarks || ""
      });
      setReceiptForm(emptyReceiptForm(selectedId));
      setMessage("Receipt recorded");
      await openBilling(selectedId);
      await reloadList();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not record receipt");
    } finally {
      end();
    }
  }

  async function handleStatus(nextStatus: string) {
    if (!selectedId) return;
    if (!tryBegin()) return;
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = { status: nextStatus };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await billingsClient.setStatus(auth.session, selectedId, payload);
      setMessage("Status set to " + nextStatus);
      await openBilling(selectedId);
      await reloadList();
    } catch (err: unknown) {
      if (!noteBillingConflict(err)) {
        setError(apiErrorMessage(err, "Could not change status"));
      }
    } finally {
      end();
    }
  }

  function openCloseBillDialog() {
    if (!selectedId) return;
    setCloseBillDialog({ reason: closeReasonOptions[0] || "" });
  }

  async function submitCloseBill() {
    if (!selectedId || !closeBillDialog) return;
    const reason = closeBillDialog.reason.trim();
    if (!reason) {
      setError("Pick a close reason");
      return;
    }
    const outstanding = totalsFromBundle(bundle).outstanding;
    const secDep = Number(totalsFromBundle(bundle).sec_dep || 0);
    const closeDescription =
      "A FINAL closing invoice will be raised first (unbilled services + security deposit applied as a receipt)." +
      (secDep > 0 ? " Deposit on file: " + formatCurrency(secDep) + "." : "");
    const ok = await confirm({
      title: "Close this bill?",
      description: closeDescription,
      confirmLabel: "Close bill",
      tone: "danger"
    });
    if (!ok) return;
    let force = false;
    if (outstanding > 0) {
      force = await confirm({
        title: "Outstanding balance",
        description:
          "After the FINAL invoice, outstanding may still be " +
          formatCurrency(outstanding) +
          " (or less if the deposit covers it). Close anyway?",
        confirmLabel: "Close anyway",
        tone: "danger"
      });
      if (!force) return;
    }
    setCloseBillDialog(null);
    if (!tryBegin()) return;
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = { reason: reason, force: force };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await billingsClient.close(auth.session, selectedId, payload);
      setMessage("Bill closed");
      await openBilling(selectedId);
      await reloadList();
    } catch (err: unknown) {
      if (!noteBillingConflict(err)) {
        setError(apiErrorMessage(err, "Could not close bill"));
      }
    } finally {
      end();
    }
  }

  function openReopenBillDialog() {
    if (!selectedId) return;
    setReopenBillDialog({ reason: "" });
  }

  async function submitReopenBill() {
    if (!selectedId || !reopenBillDialog) return;
    const reason = reopenBillDialog.reason.trim();
    if (!reason) {
      setError("Reason is required to reopen this bill");
      return;
    }
    setReopenBillDialog(null);
    if (!tryBegin()) return;
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = { reason: reason };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await billingsClient.reopen(auth.session, selectedId, payload);
      setMessage("Bill reopened");
      await openBilling(selectedId);
      await reloadList();
    } catch (err: unknown) {
      if (!noteBillingConflict(err)) {
        setError(apiErrorMessage(err, "Could not reopen bill"));
      }
    } finally {
      end();
    }
  }

  function patientBlock() {
    const patient: Partial<PatientSnapshotDto> = bundle?.patient || {};
    const patientId = bundle?.billing?.patient_id || "-";
    const patientName = patient.name || "-";
    const patientPhone = patient.phone || "";
    const patientAddress = [patient.address, patient.area, patient.city, patient.pincode]
      .filter(Boolean)
      .join(", ");
    return (
      "<div class='meta'><strong>Patient:</strong> " +
      patientName +
      " <span style='color:#94a3b8'>(" +
      patientId +
      ")</span></div>" +
      (patientPhone
        ? "<div class='meta'><strong>Phone:</strong> " + patientPhone + "</div>"
        : "") +
      (patientAddress
        ? "<div class='meta'><strong>Address:</strong> " + patientAddress + "</div>"
        : "")
    );
  }

  function printReceipt(receipt: ReceiptRowDto) {
    if (!bundle?.billing || !receipt) return;
    const num = receipt.receipt_no || receipt.id || "-";
    let invoiceLabel = "-";
    if (receipt.invoice_id && bundle.invoices) {
      const match = bundle.invoices.find(function (row) {
        return String(row.invoice && row.invoice.id) === String(receipt.invoice_id);
      });
      if (match && match.invoice) invoiceLabel = match.invoice.invoice_no || match.invoice.id;
    }
    const body =
      "<h2 style='margin:0 0 6px'>Receipt</h2>" +
      "<div class='meta'><strong>Receipt no:</strong> " + num + "</div>" +
      "<div class='meta'><strong>Date:</strong> " +
      formatDate(receipt.date || (receipt as ReceiptRowDto & { created_at?: string }).created_at) +
      "</div>" +
      "<div class='meta'><strong>Against invoice:</strong> " + invoiceLabel + "</div>" +
      patientBlock() +
      "<table style='margin-top:14px'><tbody>" +
      "<tr><th style='width:35%'>Type</th><td>" + (receipt.type || "Advance") + "</td></tr>" +
      "<tr><th>Method</th><td>" + (receipt.method || "Cash") + "</td></tr>" +
      "<tr><th>Reference</th><td>" + (receipt.ref || "-") + "</td></tr>" +
      "<tr><th>Remarks</th><td>" + (receipt.remarks || "-") + "</td></tr>" +
      "<tr><th>Amount</th><td><strong>" + formatCurrency(receipt.amount) + "</strong></td></tr>" +
      "<tr><th>Amount (in words)</th><td>Rupees " + amountWords(receipt.amount) + " only</td></tr>" +
      "</tbody></table>" +
      "<div class='stamp'>This is a system-generated receipt. Subject to realisation of cheque / UPI / NEFT.</div>";
    if (!openPrintWindow("Receipt " + num, body)) reportPrintBlocked(setError);
  }

  function printDepositReceipt() {
    if (!bundle?.billing) return;
    const amount = Number(bundle.billing.sec_dep || 0);
    const body =
      "<h2 style='margin:0 0 6px'>Security Deposit Receipt</h2>" +
      "<div class='meta'><strong>Bill account:</strong> " + bundle.billing.id + "</div>" +
      "<div class='meta'><strong>Date:</strong> " + formatDate(bundle.billing.created_at || bundle.billing.created) + "</div>" +
      patientBlock() +
      "<table style='margin-top:14px'><tbody>" +
      "<tr><th style='width:35%'>Type</th><td>Security Deposit</td></tr>" +
      "<tr><th>Amount</th><td><strong>" + formatCurrency(amount) + "</strong></td></tr>" +
      "<tr><th>Amount (in words)</th><td>Rupees " + amountWords(amount) + " only</td></tr>" +
      "</tbody></table>" +
      "<div class='stamp'>Refundable on bill close / patient discharge after settlement of dues.</div>";
    if (!openPrintWindow("Security Deposit " + bundle.billing.id, body)) reportPrintBlocked(setError);
  }

  async function printInvoiceById(invoiceId: string) {
    if (!selectedId || !invoiceId) return;
    const preOpened = preOpenPrintWindow();
    if (!preOpened) {
      reportPrintBlocked(setError);
      return;
    }
    if (!tryBegin()) {
      writePrintWindowMessage(
        "Invoice busy",
        "<h1>Invoice is already processing</h1><p>Please wait for the current action to finish, then try again.</p>",
        preOpened
      );
      return;
    }
    try {
      const data = await billingsClient.getInvoice(auth.session, selectedId, invoiceId);
      const inv = data.invoice || {};
      const lines = data.lines || [];
      const summary = summarizeInvoiceLines(lines, employeeNameById);
      const totalDays = summary.groups.reduce(function (s, g) { return s + g.days; }, 0);
      const rows = summary.groups
        .map(function (g) {
          const rangeLabel = g.from
            ? (g.from === g.to ? formatDate(g.from) : formatDate(g.from) + " — " + formatDate(g.to))
            : "-";
          return (
            "<tr><td>" + g.service_name + "</td>" +
            "<td>" + rangeLabel + "</td>" +
            "<td style='text-align:right'>" + g.days + "</td>" +
            "<td style='text-align:right'>" + formatCurrency(g.rate) + "</td>" +
            "<td style='text-align:right'><strong>" + formatCurrency(g.total) + "</strong></td></tr>"
          );
        })
        .join("");
      const amount = Number(inv.amount || 0);
      const received = Number(data.received || 0);
      const outstanding = Number(data.outstanding || 0);
      const status = data.status || inv.status || "UNPAID";
      const period = inv.period
        ? " for " + inv.period
        : (inv.from_date ? " (" + formatDate(inv.from_date) + " — " + formatDate(inv.to_date) + ")" : "");
      const partnerLabel = summary.partners.length
        ? summary.partners.length === 1
          ? "Care partner: <strong>" + summary.partners[0] + "</strong>"
          : "Care partners (" + summary.partners.length + "): <strong>" + summary.partners.join(", ") + "</strong>"
        : "Care partner: <strong>—</strong>";
      const body =
        "<h2 style='margin:0 0 6px'>Invoice" + period + "</h2>" +
        "<div class='meta'><strong>Invoice no:</strong> " + (inv.invoice_no || inv.id) + "</div>" +
        "<div class='meta'><strong>Date:</strong> " + formatDate(inv.created_at) + "</div>" +
        "<div class='meta'><strong>Status:</strong> " + status + "</div>" +
        patientBlock() +
        "<div class='meta'>" + partnerLabel + "</div>" +
        "<h3>Charges</h3>" +
        "<table><thead><tr><th>Service</th><th>Period</th><th style='text-align:right'>Days</th><th style='text-align:right'>Per-day charge</th><th style='text-align:right'>Total</th></tr></thead><tbody>" +
        (rows || "<tr><td colspan='5'>No items</td></tr>") +
        "<tr><td colspan='2' style='text-align:right'><strong>Total duties</strong></td><td style='text-align:right'><strong>" + totalDays + "</strong></td><td style='text-align:right'><strong>Subtotal</strong></td><td style='text-align:right'><strong>" + formatCurrency(amount) + "</strong></td></tr>" +
        "<tr><td colspan='4' style='text-align:right'>Received</td><td style='text-align:right'>" + formatCurrency(received) + "</td></tr>" +
        "<tr><td colspan='4' style='text-align:right'><strong>Balance due</strong></td><td style='text-align:right'><strong>" + formatCurrency(outstanding) + "</strong></td></tr>" +
        "</tbody></table>" +
        "<div class='meta' style='margin-top:14px'><strong>Amount (in words):</strong> Rupees " + amountWords(amount) + " only</div>";
      openPrintWindow("Invoice " + (inv.invoice_no || inv.id), body, preOpened);
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)) || "Could not load invoice";
      const safeMsg = msg
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      setError(msg);
      writePrintWindowMessage(
        "Invoice unavailable",
        "<h1>Could not load invoice</h1><p>" + safeMsg + "</p><p>Please close this window and try again.</p>",
        preOpened
      );
    } finally {
      end();
    }
  }

  function printBill() {
    if (!bundle?.billing) return;
    const totals = totalsFromBundle(bundle);
    const summary = summarizeInvoiceLines(bundle.services || [], employeeNameById);
    const totalDays = summary.groups.reduce(function (s, g) { return s + g.days; }, 0);
    const serviceRows = summary.groups
      .map(function (g) {
        const rangeLabel = g.from
          ? (g.from === g.to ? formatDate(g.from) : formatDate(g.from) + " — " + formatDate(g.to))
          : "-";
        return (
          "<tr><td>" + g.service_name + "</td>" +
          "<td>" + rangeLabel + "</td>" +
          "<td style='text-align:right'>" + g.days + "</td>" +
          "<td style='text-align:right'>" + formatCurrency(g.rate) + "</td>" +
          "<td style='text-align:right'><strong>" + formatCurrency(g.total) + "</strong></td></tr>"
        );
      })
      .join("");
    const partnerLine = summary.partners.length
      ? "<div class='meta'>" +
        (summary.partners.length === 1
          ? "<strong>Care partner:</strong> " + summary.partners[0]
          : "<strong>Care partners (" + summary.partners.length + "):</strong> " + summary.partners.join(", ")) +
        "</div>"
      : "";
    const receiptRows = (bundle.receipts || [])
      .map(function (r) {
        return (
          "<tr><td>" +
          formatDate(r.date) +
          "</td><td>" +
          (r.type || "") +
          "</td><td>" +
          (r.method || "") +
          "</td><td>" +
          formatCurrency(r.amount) +
          "</td><td>" +
          (r.ref || "") +
          "</td></tr>"
        );
      })
      .join("");
    const body =
      "<h2 style='margin:0 0 6px'>Statement of Account</h2>" +
      "<div class='meta'><strong>Bill account:</strong> " + bundle.billing.id + "</div>" +
      patientBlock() +
      "<div class='meta'><strong>Status:</strong> " +
      (bundle.billing.status || "Active") + " · " + (bundle.billing.paid_status || "UNPAID") +
      "</div>" +
      partnerLine +
      "<h3>Charges</h3>" +
      "<table><thead><tr><th>Service</th><th>Period</th><th style='text-align:right'>Days</th><th style='text-align:right'>Per-day charge</th><th style='text-align:right'>Total</th></tr></thead><tbody>" +
      (serviceRows || "<tr><td colspan='5'>No entries</td></tr>") +
      "<tr><td colspan='2' style='text-align:right'><strong>Total duties</strong></td><td style='text-align:right'><strong>" + totalDays + "</strong></td><td colspan='2' style='text-align:right'><strong>" + formatCurrency(totals.billed) + "</strong></td></tr>" +
      "</tbody></table>" +
      "<h3>Receipts</h3>" +
      "<table><thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Amount</th><th>Ref</th></tr></thead><tbody>" +
      (receiptRows || "<tr><td colspan='5'>No receipts</td></tr>") +
      "</tbody></table>" +
      "<div class='meta'><strong>Billed:</strong> " +
      formatCurrency(totals.billed) +
      "</div>" +
      "<div class='meta'><strong>Receipts:</strong> " +
      formatCurrency(totals.receipts) +
      "</div>" +
      "<div class='meta'><strong>Security Deposit:</strong> " +
      formatCurrency(totals.sec_dep) +
      "</div>" +
      "<div class='meta'><strong>Outstanding:</strong> " +
      formatCurrency(totals.outstanding) +
      "</div>";
    if (!openPrintWindow("Statement " + bundle.billing.id, body)) reportPrintBlocked(setError);
  }

  async function loadPatientInvoices(patientId: string) {
    const data = (await billingsClient.listForPatient(auth.session, patientId)) as {
      billings?: { sec_dep?: number }[];
      receipts?: ReceiptRowDto[];
      totalsByBilling?: Record<string, unknown>;
      invoices?: { invoice: InvoiceRowDto; amount?: number; received?: number; outstanding?: number; status?: string }[];
    };
    return {
      billings: data.billings || [],
      receipts: data.receipts || [],
      totalsByBilling: data.totalsByBilling || {},
      invoices: data.invoices || []
    };
  }

  async function handleRegenerateInvoice(invoiceId: string, invoiceLabel?: string) {
    if (!selectedId || !invoiceId) return;
    const ok = await confirm({
      title: "Regenerate invoice?",
      description:
        "Regenerate invoice " +
        (invoiceLabel || invoiceId) +
        "? This rebuilds line items from current service entries (only when no receipts are applied).",
      confirmLabel: "Regenerate"
    });
    if (!ok) return;
    if (!tryBegin()) return;
    setError("");
    try {
      await billingsClient.regenerateInvoice(auth.session, selectedId, invoiceId);
      setMessage("Invoice regenerated from latest services");
      await openBilling(selectedId);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not regenerate invoice");
    } finally {
      end();
    }
  }

  async function handleGenerateFinalInvoice() {
    if (!selectedId) return;
    const totals = totalsFromBundle(bundle);
    const secDep = Number(totals.sec_dep || 0);
    const confirmMsg =
      "Generate FINAL closing invoice for this bill?\n\n" +
      "• All unbilled service entries will be added to a new invoice (full gross).\n" +
      (secDep > 0
        ? "• Security deposit (" +
          formatCurrency(secDep) +
          ") will be recorded as a Security receipt against that invoice.\n"
        : "") +
      (secDep > 0
        ? "• If the deposit exceeds the bill, a Refund receipt will be created for the excess.\n"
        : "") +
      "\nClosing the bill later will reuse this FINAL invoice if it already exists.";
    const ok = await confirm({
      title: "Generate FINAL invoice?",
      description: confirmMsg,
      confirmLabel: "Generate"
    });
    if (!ok) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const data = await billingsClient.generateFinalInvoice(auth.session, selectedId);
      if (data && data.duplicate) {
        setMessage("FINAL invoice already exists — opened existing");
      } else {
        const parts = ["FINAL invoice generated"];
        if (data && Number(data.sec_dep_applied || 0) > 0) {
          parts.push(
            "deposit " + formatCurrency(data.sec_dep_applied) + " applied as Security receipt"
          );
        }
        if (data && Number(data.refund_amount || 0) > 0) {
          parts.push("refund " + formatCurrency(data.refund_amount) + " owed to patient");
        }
        setMessage(parts.join(" · "));
      }
      await openBilling(selectedId);
      await reloadList();
      if (data && data.invoice && data.invoice.id) printInvoiceById(data.invoice.id);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not generate FINAL invoice");
    } finally {
      end();
    }
  }

  async function handleGenerateManualInvoice(lines: ManualInvoiceLine[]) {
    if (!selectedId || !lines.length) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const data = await billingsClient.createInvoice(auth.session, selectedId, {
        kind: "MANUAL",
        manual_lines: lines
      });
      setMessage("Manual invoice created");
      await openBilling(selectedId);
      await reloadList();
      if (data && data.invoice && data.invoice.id) printInvoiceById(data.invoice.id);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not create manual invoice");
    } finally {
      end();
    }
  }

  function openPatientAccount() {
    const currentBundle = bundle;
    const pid = currentBundle?.billing?.patient_id;
    if (!pid || !currentBundle) return;
    const preOpened = preOpenPrintWindow();
    if (!preOpened) {
      reportPrintBlocked(setError);
      return;
    }
    if (!tryBegin()) return;
    loadPatientInvoices(pid)
      .then(function (data) {
        const receipts = data.receipts || [];
        const invoices = data.invoices || [];
        const bills = data.billings || [];
        const name = currentBundle.patient?.name || pid;
        const invoiceRows = invoices
          .map(function (row) {
            const inv = row.invoice;
            return (
              "<tr><td>" + (inv.invoice_no || inv.id) + "</td><td>" +
              formatDate(inv.created_at) + "</td><td>" +
              (inv.kind || "MONTHLY") + "</td><td>" +
              (inv.period || (inv.from_date ? formatDate(inv.from_date) + " — " + formatDate(inv.to_date) : "-")) + "</td><td>" +
              (row.status || inv.status || "UNPAID") + "</td><td>" +
              formatCurrency(row.amount) + "</td><td>" +
              formatCurrency(row.received) + "</td><td>" +
              formatCurrency(row.outstanding) + "</td></tr>"
            );
          })
          .join("");
        const receiptRows = receipts
          .map(function (r) {
            return (
              "<tr><td>" + (r.receipt_no || r.id) + "</td><td>" +
              formatDate(r.date) + "</td><td>" +
              (r.invoice_id || "-") + "</td><td>" +
              (r.type || "") + "</td><td>" +
              (r.method || "") + "</td><td>" +
              formatCurrency(r.amount) + "</td><td>" +
              (r.ref || "-") + "</td></tr>"
            );
          })
          .join("");
        const totalInvoiced = invoices.reduce(function (s, row) { return s + Number(row.amount || 0); }, 0);
        const totalReceived = invoices.reduce(function (s, row) { return s + Number(row.received || 0); }, 0);
        const totalOutstanding = invoices.reduce(function (s, row) { return s + Number(row.outstanding || 0); }, 0);
        const totalSecDep = bills.reduce(function (s, b) { return s + Number(b.sec_dep || 0); }, 0);
        const body =
          "<h2 style='margin:0 0 6px'>Patient Account Ledger</h2>" +
          "<div class='meta'><strong>Patient:</strong> " + name + " <span style='color:#94a3b8'>(" + pid + ")</span></div>" +
          "<h3>Invoices</h3>" +
          "<table><thead><tr><th>Invoice no</th><th>Date</th><th>Kind</th><th>Period</th><th>Status</th><th>Amount</th><th>Received</th><th>Outstanding</th></tr></thead><tbody>" +
          (invoiceRows || "<tr><td colspan='8'>No invoices</td></tr>") +
          "</tbody></table>" +
          "<h3>Receipts</h3>" +
          "<table><thead><tr><th>Receipt no</th><th>Date</th><th>Invoice</th><th>Type</th><th>Method</th><th>Amount</th><th>Ref</th></tr></thead><tbody>" +
          (receiptRows || "<tr><td colspan='7'>No receipts</td></tr>") +
          "</tbody></table>" +
          "<div class='meta' style='margin-top:14px'><strong>Total invoiced:</strong> " + formatCurrency(totalInvoiced) + "</div>" +
          "<div class='meta'><strong>Total received:</strong> " + formatCurrency(totalReceived) + "</div>" +
          "<div class='meta'><strong>Outstanding across invoices:</strong> " + formatCurrency(totalOutstanding) + "</div>" +
          "<div class='meta'><strong>Security deposits held:</strong> " + formatCurrency(totalSecDep) + "</div>";
        openPrintWindow("Patient account — " + name, body, preOpened);
      })
      .catch(function (err) {
        setError((err instanceof Error ? err.message : String(err)) || "Could not load patient account");
      })
      .finally(function () {
        end();
      });
  }

  const totals = totalsFromBundle(bundle);
  const status = String(bundle?.billing?.status || "Active");
  const paidStatus = String(bundle?.billing?.paid_status || "UNPAID");
  // Action flags come from the API (business layer); do not re-derive policy here.
  const permissions: BillingPermissionsDto = bundle?.permissions || defaultBillingPermissions();
  const receiveBlockReason =
    (permissions.blockReasons && permissions.blockReasons.canReceive) || "";
  const monthOpts = useMemo(function () { return monthOptions(12); }, []);
  const [invoicePeriod, setInvoicePeriod] = useState(monthOpts[0]?.value || "");
  const [serviceViewPeriod, setServiceViewPeriod] = useState(currentBillingMonth());
  const [showManualInvoice, setShowManualInvoice] = useState(false);
  const [manualLines, setManualLines] = useState<ManualInvoiceLine[]>([defaultManualLine()]);

  const selectedInvoiceOutstanding = useMemo(
    function () {
      if (!receiptForm.invoice_id || !bundle?.invoices) return null;
      const match = bundle.invoices.find(function (row) {
        return String(row.invoice && row.invoice.id) === String(receiptForm.invoice_id);
      });
      return match ? Number(match.outstanding || 0) : null;
    },
    [receiptForm.invoice_id, bundle]
  );

  const availablePeriods = useMemo(
    function (): string[] {
      if (!bundle?.services) return [];
      const set = new Set<string>();
      bundle.services.forEach(function (s) {
        const row = s as ServiceLineRow;
        const key = String(row.date || "").slice(0, 7);
        if (key) set.add(key);
      });
      return Array.from(set).sort().reverse();
    },
    [bundle]
  );

  const invoicePeriodOptions: MonthOption[] = useMemo(
    function () {
      const values = new Set<string>();
      values.add(currentBillingMonth());
      availablePeriods.forEach(function (p) {
        values.add(p);
      });
      monthOpts.forEach(function (p) {
        values.add(p.value);
      });
      const ordered = Array.from(values).sort().reverse();
      if (ordered.length) {
        return ordered.map(function (p) {
          return { value: p, label: monthLabel(p) };
        });
      }
      return monthOpts;
    },
    [availablePeriods, monthOpts]
  );

  const serviceViewOptions: MonthOption[] = useMemo(
    function () {
      const values = new Set<string>();
      values.add(currentBillingMonth());
      availablePeriods.forEach(function (p) {
        values.add(p);
      });
      monthOpts.forEach(function (p) {
        values.add(p.value);
      });
      return Array.from(values)
        .sort()
        .reverse()
        .map(function (p) {
          return { value: p, label: monthLabel(p) };
        });
    },
    [availablePeriods, monthOpts]
  );

  const visibleServices = useMemo(
    function (): ServiceLineRow[] {
      const rows = (bundle?.services || []) as ServiceLineRow[];
      if (!serviceViewPeriod) return rows;
      return rows.filter(function (s) {
        return String(s.date || "").slice(0, 7) === serviceViewPeriod;
      });
    },
    [bundle, serviceViewPeriod]
  );

  const visibleServicesTotal = useMemo(
    function () {
      return visibleServices.reduce(function (sum, s) {
        return sum + Number(s.total || 0);
      }, 0);
    },
    [visibleServices]
  );

  const billingPatientId = String(
    bundle?.billing?.patient_id || bundle?.patient?.id || ""
  ).trim();

  useEffect(
    function () {
      if (!billingPatientId || !serviceViewPeriod || !auth.session?.access_token) {
        setDutyLedger(null);
        return;
      }
      let cancelled = false;
      billingsClient
        .patientDutyLedger(auth.session, billingPatientId, serviceViewPeriod)
        .then(function (data) {
          if (cancelled || !data || typeof data !== "object") return;
          const row = data as { billed?: number; duty_count?: number };
          setDutyLedger({
            billed: Number(row.billed || 0),
            duty_count: Number(row.duty_count || 0)
          });
        })
        .catch(function () {
          if (!cancelled) setDutyLedger(null);
        });
      return function () {
        cancelled = true;
      };
    },
    [billingPatientId, serviceViewPeriod, auth.session]
  );

  const billingDesyncDetected = useMemo(
    function () {
      if (!dutyLedger || !bundle || status === "Cancelled") return false;
      return detectLedgerDesync({
        liveAmount: dutyLedger.billed,
        cachedAmount: visibleServicesTotal,
        liveCount: dutyLedger.duty_count,
        cachedCount: visibleServices.length,
        comparable: true
      });
    },
    [dutyLedger, bundle, status, visibleServicesTotal, visibleServices.length]
  );

  return (
    <AuthGuard permission="billings.read">
      <AppShell title="Billing">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell title="Open new bill" description="Create an Active bill for a patient. Security deposit can be added now or later.">
              <form className="stack" onSubmit={handleCreate}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="billings-patient-1">Patient</label>
                    <select id="billings-patient-1"
                      value={createPatientId}
                      onChange={function (event) {
                        setCreatePatientId(event.target.value);
                      }}
                      required
                    >
                      <option value="">Select patient</option>
                      {patients.map(function (p) {
                        return (
                          <option key={p.id} value={p.id}>
                            {(p.full_name || p.name || p.id) + (p.mobile ? " (" + p.mobile + ")" : "")}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="billings-security-deposit-2">Security deposit</label>
                    <input id="billings-security-deposit-2"
                      type="number"
                      min="0"
                      value={createSecDep}
                      onChange={function (event) {
                        setCreateSecDep(event.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy || !createPatientId}>
                    {busy ? "Saving…" : "Create bill"}
                  </button>
                </div>
              </form>
            </ModuleShell>

            <ModuleShell title="Patient bills" description="Live ledger from hh_billings. Click a row for full detail.">
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="billings-status-3">Status</label>
                  <select id="billings-status-3"
                    value={statusFilter}
                    onChange={function (event) {
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="">All statuses</option>
                    {billingStatusOptions.map(function (item) {
                      return (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="billings-search-4">Search</label>
                  <input id="billings-search-4"
                    placeholder="patient name / invoice no / phone"
                    value={search}
                    onChange={function (event) {
                      setSearch(event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <span aria-hidden="true">&nbsp;</span>
                  <button className="button secondary" type="button" onClick={reloadList}>
                    Refresh
                  </button>
                </div>
              </div>
              <ErrorBanner message={error && !conflictPrompt ? error : ""} />
              <SuccessBanner message={message} />
              {billings.length >= BILLING_LIST_LIMIT && billingsTotal > billings.length ? (
                <div className="info-text" role="status" style={{ background: "#fff7e6", border: "1px solid #ffd28d", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                  Showing first {billings.length} of {billingsTotal} bills — refine filters to narrow the list.
                </div>
              ) : null}
              {!filtered.length ? (
                <EmptyState
                  title={loading ? "Loading bills…" : "No bills"}
                  description="Bills appear here as soon as they are opened from any module."
                />
              ) : (
                <div className="record-list">
                  {filtered.map(function (row) {
                    const isSelected = selectedId === row.id;
                    return (
                      <div
                        className={"record-card" + (isSelected ? " selected" : "")}
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        onClick={function () {
                          openBilling(row.id);
                        }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3 style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                              {row.patient_name || row.patient_id || "Unnamed patient"}
                              {paidStatusBadge(row.paid_status)}
                            </h3>
                            <div className="record-meta">
                              {row.patient_phone ? <span>{row.patient_phone}</span> : null}
                              <span>Sec dep {formatCurrency(row.sec_dep)}</span>
                              {row.totals ? (
                                <span>
                                  Outstanding {formatCurrency(row.totals.outstanding)}
                                </span>
                              ) : null}
                              <span>{formatDate(row.created_at || row.created)}</span>
                            </div>
                          </div>
                          <span className={"status " + String(row.status || "Active").toLowerCase()}>{row.status || "Active"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>
          </div>

          <div className="page-grid">
            <ModuleShell
              title={bundle?.billing ? ((bundle.patient && bundle.patient.name) || "Patient account") : "Bill detail"}
              description="Services, invoices, receipts, totals — all server-computed. Each invoice generation creates a new invoice number; receipts are recorded against a specific invoice."
            >
              {!bundle ? (
                <EmptyState
                  title={bundleLoading ? "Loading…" : "Select a bill"}
                  description="Pick any bill on the left to see services, receipts, totals, and actions."
                />
              ) : (
                <div className="stack">
                  <div className="helper-box">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <strong>Patient:</strong>{" "}
                      {(bundle.patient && bundle.patient.name) || bundle.billing.patient_id || "-"}
                      {bundle.patient && bundle.patient.name && bundle.billing.patient_id ? (
                        <span className="mini-muted"> · {bundle.billing.patient_id}</span>
                      ) : null}
                      <span style={{ marginLeft: 8 }}>·</span>
                      <strong>Status:</strong> {status}
                      {paidStatusBadge(paidStatus)}
                    </div>
                    <div className="mini-muted" style={{ marginTop: 4 }}>
                      Bill account <strong>{bundle.billing.id}</strong> · Created {formatDate(bundle.billing.created_at || bundle.billing.created)}
                    </div>
                    <div className="grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <strong>Billed:</strong> {formatCurrency(totals.billed)}
                      </div>
                      <div>
                        <strong>Receipts:</strong> {formatCurrency(totals.receipts)}
                      </div>
                      <div>
                        <strong>Security deposit:</strong> {formatCurrency(totals.sec_dep)}
                      </div>
                      <div>
                        <strong>Outstanding:</strong> {formatCurrency(totals.outstanding)}
                      </div>
                    </div>
                  </div>

                  {conflictPrompt ? (
                    <div
                      className="error-text"
                      role="alert"
                      aria-live="assertive"
                      style={{
                        border: "1px solid var(--warn, #d97706)",
                        background: "rgba(217,119,6,0.08)",
                        padding: "10px 12px",
                        borderRadius: 6
                      }}
                    >
                      <div style={{ marginBottom: 6 }}>
                        <strong>Concurrent edit detected.</strong> {conflictPrompt.message}
                      </div>
                      <div className="button-row" style={{ gap: 8 }}>
                        <button
                          className="button primary"
                          type="button"
                          onClick={reloadBillingFromConflict}
                          disabled={busy}
                        >
                          Reload latest
                        </button>
                        <button
                          className="button ghost"
                          type="button"
                          onClick={function () { setConflictPrompt(null); }}
                          disabled={busy}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="button-row">
                    <button className="button secondary" type="button" onClick={printBill}>
                      Print statement
                    </button>
                    {Number(bundle.billing.sec_dep || 0) > 0 ? (
                      <button className="button secondary" type="button" onClick={printDepositReceipt}>
                        Deposit receipt PDF
                      </button>
                    ) : null}
                    <button className="button secondary" type="button" onClick={openPatientAccount} disabled={busy}>
                      Patient account ledger
                    </button>
                    {status === "Active" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          handleStatus("Paused");
                        }}
                        disabled={busy}
                      >
                        Pause
                      </button>
                    ) : null}
                    {status === "Paused" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          handleStatus("Active");
                        }}
                        disabled={busy}
                      >
                        Resume
                      </button>
                    ) : null}
                    {permissions.canClose ? (
                      <button
                        className="button danger"
                        type="button"
                        onClick={openCloseBillDialog}
                        disabled={busy}
                        title={permissions.blockReasons?.canClose}
                      >
                        Close bill
                      </button>
                    ) : null}
                    {permissions.canReopen ? (
                      <button className="button secondary" type="button" onClick={openReopenBillDialog} disabled={busy}>
                        Reopen
                      </button>
                    ) : null}
                  </div>

                  <div className="stack">
                    <strong>Generate invoice</strong>
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-billing-month-6">Billing month</label>
                        <select id="billings-billing-month-6"
                          value={invoicePeriod}
                          onChange={function (event) {
                            setInvoicePeriod(event.target.value);
                          }}
                          disabled={!permissions.canEdit}
                        >
                          {invoicePeriodOptions.map(function (opt) {
                            return (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="field">
                        <span aria-hidden="true">&nbsp;</span>
                        <button
                          className="button primary"
                          type="button"
                          onClick={async function () {
                            const inv = await handleGenerateInvoice("MONTHLY", invoicePeriod);
                            if (inv && inv.id) printInvoiceById(inv.id);
                          }}
                          disabled={!invoicePeriod || !permissions.canEdit || busy}
                        >
                          Generate monthly invoice
                        </button>
                      </div>
                    </div>
                    <div className="mini-muted">
                      Snapshots all services dated in the chosen month into a new invoice with its own number. The new invoice opens as UNPAID — record receipts below to move it to PARTIAL/PAID.
                    </div>
                    {permissions.canGenerateFinal ? (
                      <div className="stack" style={{ marginTop: 12 }}>
                        <button
                          className="button primary"
                          type="button"
                          onClick={handleGenerateFinalInvoice}
                          disabled={busy}
                          title={
                            permissions.blockReasons?.canGenerateFinal ||
                            (status === "Closed"
                              ? "This bill is Closed but never got a FINAL invoice — recover unbilled service days and apply the security deposit"
                              : "Snapshot remaining services + apply security deposit + auto-refund any excess")
                          }
                        >
                          {status === "Closed"
                            ? "Generate FINAL invoice (recover closed bill)"
                            : "Generate FINAL invoice (apply deposit)"}
                        </button>
                        <div className="mini-muted">
                          {status === "Closed"
                            ? "This bill was closed before the FINAL flow shipped. Generating the FINAL invoice now will snapshot unbilled service days and apply the security deposit (" + formatCurrency(totals.sec_dep) + ") as a Security receipt."
                            : "Final settlement: snapshots unbilled services at full gross, records the security deposit (" + formatCurrency(totals.sec_dep) + ") as a Security receipt on that invoice, and auto-refunds any excess. Also runs automatically when you close the bill or close the patient. One FINAL invoice per bill."}
                        </div>
                      </div>
                    ) : null}
                    {permissions.canEdit ? (
                      <div className="stack" style={{ marginTop: 12 }}>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={function () { setShowManualInvoice(!showManualInvoice); }}
                        >
                          {showManualInvoice ? "Hide manual invoice" : "Manual invoice (ad-hoc)"}
                        </button>
                        {showManualInvoice ? (
                          <div className="stack">
                            {manualLines.map(function (line, idx) {
                              return (
                                <div className="grid-2" key={"ml-" + idx}>
                                  <div className="field">
                                    <label htmlFor="billings-date-8">Date</label>
                                    <input id="billings-date-8"
                                      type="date"
                                      max={ledgerBackdatedDateMax()}
                                      value={line.date}
                                      onChange={function (e) {
                                        const next = manualLines.slice();
                                        next[idx] = { ...line, date: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-service-9">Service</label>
                                    <input id="billings-service-9"
                                      value={line.service_name}
                                      onChange={function (e) {
                                        const next = manualLines.slice();
                                        next[idx] = { ...line, service_name: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-partner-id-optional-10">Partner id (optional)</label>
                                    <input id="billings-partner-id-optional-10"
                                      value={line.partner}
                                      onChange={function (e) {
                                        const next = manualLines.slice();
                                        next[idx] = { ...line, partner: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-per-day-charge-11">Per-day charge</label>
                                    <input id="billings-per-day-charge-11"
                                      type="number"
                                      min="0"
                                      value={line.amt}
                                      onChange={function (e) {
                                        const amt = Number(e.target.value || 0);
                                        const next = manualLines.slice();
                                        next[idx] = {
                                          ...line,
                                          amt: amt,
                                          total: amt * Number(line.count || 1)
                                        };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-days-12">Days</label>
                                    <input id="billings-days-12"
                                      type="number"
                                      min="1"
                                      value={line.count}
                                      onChange={function (e) {
                                        const count = Number(e.target.value || 1);
                                        const next = manualLines.slice();
                                        next[idx] = {
                                          ...line,
                                          count: count,
                                          total: Number(line.amt || 0) * count
                                        };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-total-13">Total</label>
                                    <input id="billings-total-13" type="number" min="0" value={line.total} readOnly />
                                  </div>
                                </div>
                              );
                            })}
                            <div className="button-row">
                              <button
                                className="button secondary"
                                type="button"
                                onClick={function () {
                                  setManualLines(
                                    manualLines.concat({
                                      date: crmTodayIso(),
                                      service_name: "Care Taker Services",
                                      partner: "",
                                      count: 1,
                                      amt: 750,
                                      total: 750
                                    })
                                  );
                                }}
                              >
                                Add line
                              </button>
                              <button
                                className="button primary"
                                type="button"
                                disabled={busy}
                                onClick={function () { handleGenerateManualInvoice(manualLines); }}
                              >
                                Create manual invoice
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="table-wrap">
                    <strong>Invoices</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice no</th>
                          <th>Kind</th>
                          <th>Period</th>
                          <th>Amount</th>
                          <th>Received</th>
                          <th>Outstanding</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.invoices || !bundle.invoices.length ? (
                          <tr>
                            <td colSpan={9} className="mini-muted">
                              No invoices yet. Generate a monthly invoice above (or a manual one for ad-hoc charges).
                            </td>
                          </tr>
                        ) : (
                          bundle.invoices.map(function (row) {
                            const inv = row.invoice;
                            const statusUpper = String(row.status || "UNPAID").toUpperCase();
                            return (
                              <tr key={inv.id}>
                                <td>{inv.invoice_no || inv.id}</td>
                                <td>{inv.kind}</td>
                                <td>{inv.period || (inv.from_date ? formatDate(inv.from_date) + " — " + formatDate(inv.to_date) : "-")}</td>
                                <td>{formatCurrency(row.amount)}</td>
                                <td>{formatCurrency(row.received)}</td>
                                <td>{formatCurrency(row.outstanding)}</td>
                                <td>{paidStatusBadge(statusUpper)}</td>
                                <td>{formatDate(inv.created_at)}</td>
                                <td>
                                  <div className="button-row" style={{ gap: 4 }}>
                                    <button
                                      className="button secondary"
                                      type="button"
                                      onClick={function () { printInvoiceById(inv.id); }}
                                    >
                                      PDF
                                    </button>
                                    {inv.kind === "MONTHLY" &&
                                    Number(row.received || 0) <= 0 &&
                                    statusUpper !== "PAID" &&
                                    permissions.canEdit ? (
                                      <button
                                        className="button secondary"
                                        type="button"
                                        onClick={function () {
                                          handleRegenerateInvoice(
                                            inv.id,
                                            inv.invoice_no || inv.id
                                          );
                                        }}
                                      >
                                        Regenerate
                                      </button>
                                    ) : null}
                                    {statusUpper !== "PAID" && permissions.canEdit ? (
                                      <button
                                        className="button danger"
                                        type="button"
                                        onClick={function () {
                                          handleDeleteInvoice(
                                            inv.id,
                                            inv.invoice_no || inv.id
                                          );
                                        }}
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form className="stack" onSubmit={handleSecDepSave}>
                    <strong>Security deposit</strong>
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-amount-14">Amount</label>
                        <input id="billings-amount-14"
                          type="number"
                          min="0"
                          value={secDepForm.sec_dep}
                          onChange={function (event) {
                            setSecDepForm({ sec_dep: event.target.value });
                          }}
                          disabled={!permissions.canEdit}
                        />
                      </div>
                      <div className="field">
                        <span aria-hidden="true">&nbsp;</span>
                        <button className="button primary" type="submit" disabled={busy || !permissions.canEdit}>
                          Update deposit
                        </button>
                      </div>
                    </div>
                  </form>

                  <div
                    className="helper-box"
                    style={{ marginBottom: 10, background: "#f8fafc", borderColor: "#cbd5e1" }}
                  >
                    {DUTY_LEDGER_READONLY_MESSAGE}{" "}
                    <a href="/duties" style={{ fontWeight: 600 }}>
                      Open Duty Calendar →
                    </a>
                  </div>
                  {billingDesyncDetected ? (
                    <div
                      role="alert"
                      style={{
                        marginBottom: 10,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "#fef2f2",
                        border: "2px solid #dc2626",
                        color: "#991b1b",
                        fontSize: 13,
                        fontWeight: 600
                      }}
                    >
                      {DESYNC_ALERT_HEADLINE}
                      <div style={{ fontWeight: 400, marginTop: 4 }}>
                        Duty calendar ledger ({formatCurrency(dutyLedger?.billed || 0)} ·{" "}
                        {dutyLedger?.duty_count || 0} days) does not match this bill&apos;s displayed
                        services ({formatCurrency(visibleServicesTotal)} · {visibleServices.length}{" "}
                        days). Receipt entry is blocked until the ledger is reconciled from the Duty
                        Calendar.
                      </div>
                    </div>
                  ) : null}

                  <div className="table-wrap">
                    <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                      <div>
                        <strong>Services</strong>
                        <div className="mini-muted">
                          Showing {monthLabel(serviceViewPeriod)} duty entries only ·{" "}
                          {visibleServices.length} day{visibleServices.length === 1 ? "" : "s"} ·{" "}
                          {formatCurrency(visibleServicesTotal)}
                        </div>
                      </div>
                      <div className="field" style={{ minWidth: 220 }}>
                        <label htmlFor="billings-service-view-month">View duty month</label>
                        <select
                          id="billings-service-view-month"
                          value={serviceViewPeriod}
                          onChange={function (event) {
                            setServiceViewPeriod(event.target.value);
                          }}
                        >
                          {serviceViewOptions.map(function (opt) {
                            return (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Service</th>
                          <th>Partner</th>
                          <th>Count</th>
                          <th>Rate</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.services || !bundle.services.length ? (
                          <tr>
                            <td colSpan={6} className="mini-muted">
                              No service entries yet. Generate from a duty in the Duties module.
                            </td>
                          </tr>
                        ) : !visibleServices.length ? (
                          <tr>
                            <td colSpan={6} className="mini-muted">
                              No duty entries for {monthLabel(serviceViewPeriod)}. Use the month selector above to open previous month entries.
                            </td>
                          </tr>
                        ) : (
                          visibleServices.map(function (s) {
                            const rowKey = String(s.id || s.svc_key || "") + "-" + String(s.date || "");
                            return (
                              <tr key={rowKey}>
                                <td>{formatDate(s.date)}</td>
                                <td>{s.service_name}</td>
                                <td>{s.partner || "-"}</td>
                                <td>{s.count}</td>
                                <td>{formatCurrency(s.amt)}</td>
                                <td>{formatCurrency(s.total)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form className="stack" onSubmit={handleReceiptSubmit}>
                    <strong>Add receipt</strong>
                    {status === "Cancelled" ? (
                      <div className="helper-box" style={{ background: "#fee2e2", color: "#991b1b" }}>
                        Bill is Cancelled — receipts cannot be recorded against a voided bill.
                      </div>
                    ) : status === "Closed" ? (
                      <div className="helper-box" style={{ background: "#fef3c7", color: "#92400e" }}>
                        Bill is Closed. You can still record receipts to settle outstanding invoices on it without reopening the bill.
                      </div>
                    ) : null}
                    {selectedInvoiceOutstanding != null ? (
                      <div className="mini-muted">
                        Invoice outstanding: <strong>{formatCurrency(selectedInvoiceOutstanding)}</strong>
                        {Number(receiptForm.amount || 0) > selectedInvoiceOutstanding + 0.005 ? (
                          <span style={{ color: "#dc2626", marginLeft: 8 }}>
                            Amount exceeds outstanding
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-apply-to-invoice-16">Apply to invoice</label>
                        <select id="billings-apply-to-invoice-16"
                          value={receiptForm.invoice_id}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, invoice_id: event.target.value });
                          }}
                          disabled={!permissions.canReceive}
                        >
                          <option value="">No invoice (on-account / advance)</option>
                          {(bundle.invoices || [])
                            .filter(function (row) {
                              const st = String(row.status || "").toUpperCase();
                              return st !== "CANCELLED" && st !== "PAID";
                            })
                            .map(function (row) {
                              const inv = row.invoice;
                              return (
                                <option key={inv.id} value={inv.id}>
                                  {(inv.invoice_no || inv.id) +
                                    (inv.period ? " · " + inv.period : "") +
                                    " · outstanding " + formatCurrency(row.outstanding)}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="billings-type-17">Type</label>
                        <select id="billings-type-17"
                          value={receiptForm.type}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, type: event.target.value });
                          }}
                          disabled={!permissions.canReceive}
                        >
                          {receiptTypeOptions.map(function (o) {
                            return (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="billings-method-18">Method</label>
                        <select id="billings-method-18"
                          value={receiptForm.method}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, method: event.target.value });
                          }}
                          disabled={!permissions.canReceive}
                        >
                          {paymentMethodOptions.map(function (o) {
                            return (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="billings-amount-19">Amount</label>
                        <input id="billings-amount-19"
                          type="number"
                          min="0"
                          value={receiptForm.amount}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, amount: event.target.value });
                          }}
                          required
                          disabled={!permissions.canReceive}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-date-20">Date</label>
                        <input id="billings-date-20"
                          type="date"
                          max={ledgerBackdatedDateMax()}
                          value={receiptForm.date}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, date: event.target.value });
                          }}
                          required
                          disabled={!permissions.canReceive}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-reference-21">Reference</label>
                        <input id="billings-reference-21"
                          value={receiptForm.ref}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, ref: event.target.value });
                          }}
                          placeholder="UPI ref / cheque no"
                          disabled={!permissions.canReceive}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-remarks-22">Remarks</label>
                        <input id="billings-remarks-22"
                          value={receiptForm.remarks}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, remarks: event.target.value });
                          }}
                          disabled={!permissions.canReceive}
                        />
                      </div>
                    </div>
                    <div className="button-row">
                      <button
                        className="button success"
                        type="submit"
                        disabled={
                          busy ||
                          billingDesyncDetected ||
                          !permissions.canReceive ||
                          (selectedInvoiceOutstanding != null &&
                            Number(receiptForm.amount || 0) >
                              selectedInvoiceOutstanding + 0.005)
                        }
                        title={
                          billingDesyncDetected
                            ? DESYNC_ALERT_HEADLINE
                            : receiveBlockReason ||
                          (selectedInvoiceOutstanding != null &&
                          Number(receiptForm.amount || 0) >
                            selectedInvoiceOutstanding + 0.005
                            ? "Amount exceeds invoice outstanding"
                            : undefined)
                        }
                      >
                        Record receipt
                      </button>
                      {billingDesyncDetected ? (
                        <span className="mini-muted" style={{ color: "#dc2626" }}>
                          Blocked — duty ledger desync
                        </span>
                      ) : null}
                    </div>
                  </form>

                  <div className="table-wrap">
                    <strong>Receipts ledger</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Receipt no</th>
                          <th>Date</th>
                          <th>Applied to</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Amount</th>
                          <th>Ref</th>
                          <th>Remarks</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.receipts || !bundle.receipts.length ? (
                          <tr>
                            <td colSpan={9} className="mini-muted">
                              No receipts recorded.
                            </td>
                          </tr>
                        ) : (
                          bundle.receipts.map(function (r) {
                            let invLabel = "-";
                            if (r.invoice_id && bundle!.invoices) {
                              const match = bundle!.invoices.find(function (row) {
                                return (
                                  String(row.invoice && row.invoice.id) === String(r.invoice_id)
                                );
                              });
                              if (match?.invoice) {
                                invLabel = match.invoice.invoice_no || match.invoice.id;
                              }
                            }
                            return (
                              <tr key={r.id}>
                                <td>{r.receipt_no || r.id}</td>
                                <td>{formatDate(r.date)}</td>
                                <td>{invLabel}</td>
                                <td>{r.type}</td>
                                <td>{r.method}</td>
                                <td>{formatCurrency(r.amount)}</td>
                                <td>{r.ref || "-"}</td>
                                <td>{r.remarks || "-"}</td>
                                <td>
                                  <button
                                    className="button secondary"
                                    type="button"
                                    onClick={function () { printReceipt(r); }}
                                  >
                                    PDF
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </ModuleShell>
          </div>
        </div>
        {closeBillDialog ? (
          <ModalDialog
            open
            onClose={function () { setCloseBillDialog(null); }}
            lockClose={busy}
            title="Close bill"
          >
              <p className="mini-muted">Reason is stored in the audit log.</p>
              <div className="field">
                <label htmlFor="billings-close-reason">Reason</label>
                <select
                  id="billings-close-reason"
                  value={closeBillDialog.reason}
                  onChange={function (event) {
                    const value = event.target.value;
                    setCloseBillDialog(function (d) {
                      return d ? { ...d, reason: value } : d;
                    });
                  }}
                  required
                >
                  {closeReasonOptions.map(function (r) {
                    return (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="button-row">
                <button
                  className="button ghost"
                  type="button"
                  onClick={function () {
                    setCloseBillDialog(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={submitCloseBill}
                  disabled={busy}
                >
                  Continue
                </button>
              </div>
          </ModalDialog>
        ) : null}
        {reopenBillDialog ? (
          <ModalDialog
            open
            onClose={function () { setReopenBillDialog(null); }}
            onRequestClose={function () {
              confirmDiscardTyped(
                confirm,
                reopenBillDialog.reason.trim().length > 0,
                function () { setReopenBillDialog(null); }
              );
            }}
            lockClose={busy}
            title="Reopen bill"
          >
              <div className="field">
                <label htmlFor="billings-reopen-reason">Reason</label>
                <input
                  id="billings-reopen-reason"
                  value={reopenBillDialog.reason}
                  onChange={function (event) {
                    const value = event.target.value;
                    setReopenBillDialog(function (d) {
                      return d ? { ...d, reason: value } : d;
                    });
                  }}
                  maxLength={500}
                  required
                />
              </div>
              <div className="button-row">
                <button
                  className="button ghost"
                  type="button"
                  onClick={function () {
                    setReopenBillDialog(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="button primary" type="button" onClick={submitReopenBill} disabled={busy}>
                  Reopen
                </button>
              </div>
          </ModalDialog>
        ) : null}
      </AppShell>
    </AuthGuard>
  );
}
