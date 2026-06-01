"use client";

/**
 * Payout ledger UI (M9 Pass D). Date/form helpers: `@/lib/payoutUi`.
 * All writes via `/api/v1/payouts/*`.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { paymentMethodOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import {
  PAYOUT_PAY_ROLES,
  PAYOUT_REOPEN_ROLES,
  PAYOUT_WRITE_ROLES
} from "@/business/rbac";
import {
  PAYOUT_STATUS_OPTIONS,
  currentPeriod,
  emptyAdjustForm,
  emptyAdvanceForm,
  emptyEnsureForm,
  emptyPayForm,
  istDayKey
} from "@/lib/payoutUi";

function roleInList(role, list) {
  var normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

function PayoutsPageContent() {
  var auth = useAuth();
  var userRole = auth.profile?.role || "";
  var canWrite = roleInList(userRole, PAYOUT_WRITE_ROLES);
  var canDisburse = roleInList(userRole, PAYOUT_PAY_ROLES);
  var canReopen = roleInList(userRole, PAYOUT_REOPEN_ROLES);
  var searchParams = useSearchParams();
  var [employees, setEmployees] = useState([]);
  var [payouts, setPayouts] = useState([]);
  // P1-28: track API limit + server total for the "Showing first N of M" cap
  // banner. With a 200-row cap, busy practices used to silently lose payouts
  // 201+ from the ledger.
  var PAYOUTS_LIMIT = 200;
  var [payoutsTotal, setPayoutsTotal] = useState(0);
  var [loading, setLoading] = useState(true);
  var [periodFilter, setPeriodFilter] = useState(
    searchParams?.get("period") || currentPeriod()
  );
  var [statusFilter, setStatusFilter] = useState("");
  var [employeeFilter, setEmployeeFilter] = useState(
    searchParams?.get("employee_id") || ""
  );
  var [selectedId, setSelectedId] = useState("");
  var [detail, setDetail] = useState(null);
  var [detailLoading, setDetailLoading] = useState(false);
  var [ensureForm, setEnsureForm] = useState(function () {
    var base = emptyEnsureForm();
    var ep = searchParams?.get("employee_id");
    var pm = searchParams?.get("period");
    if (ep) base.employee_id = ep;
    if (pm) base.period_month = pm;
    return base;
  });
  var [adjustForm, setAdjustForm] = useState(emptyAdjustForm());
  var [payForm, setPayForm] = useState(emptyPayForm());
  var [advanceForm, setAdvanceForm] = useState(emptyAdvanceForm());
  // P1-29: every URL.createObjectURL() we mint for a proof preview must
  // eventually be released, otherwise the file's bytes stay in browser memory
  // until the tab closes. The ref accumulates created URLs and the unmount
  // cleanup + per-replace dispose calls revoke them.
  var proofObjectUrlsRef = useRef([]);
  useEffect(function () {
    return function cleanup() {
      try {
        proofObjectUrlsRef.current.forEach(function (u) {
          if (u) URL.revokeObjectURL(u);
        });
      } catch (_e) { /* tab closing — best effort */ }
      proofObjectUrlsRef.current = [];
    };
  }, []);
  function disposeProofObjectUrl(proof) {
    if (!proof || !proof.preview_url) return;
    try { URL.revokeObjectURL(proof.preview_url); } catch (_e) { /* noop */ }
    proofObjectUrlsRef.current = proofObjectUrlsRef.current.filter(function (u) {
      return u !== proof.preview_url;
    });
  }
  var [advanceOpen, setAdvanceOpen] = useState(false);
  var [rateRepairRate, setRateRepairRate] = useState("");
  var [pending, setPending] = useState(null);
  var [auditTrail, setAuditTrail] = useState([]);
  var [unpaidSearch, setUnpaidSearch] = useState("");
  var [ledgerSearch, setLedgerSearch] = useState("");
  // Ref lets the "front-of-page" unpaid banner scroll the actual list
  // panel into view when the user clicks "Jump to list".
  var unpaidPanelRef = useRef(null);
  var [unpaidEmployees, setUnpaidEmployees] = useState({
    period: "",
    rows: [],
    total_pending: 0,
    loading: false,
    source: "rpc",
    error: ""
  });
  var [busy, setBusy] = useState(false);
  var [error, setErrorState] = useState("");
  var [detailError, setDetailError] = useState("");
  var [message, setMessageState] = useState("");
  var toast = useToast();
  var setError = useCallback(function (msg) {
    var text = String(msg || "");
    setErrorState(text);
    if (text) toast.error(text);
  }, [toast]);
  var setMessage = useCallback(function (msg) {
    var text = String(msg || "");
    setMessageState(text);
    if (text) toast.success(text);
  }, [toast]);
  var [lockReason, setLockReason] = useState("");
  var [reopenReason, setReopenReason] = useState("");
  /** null | "pay" | "advance" — second-step confirmation before disbursement */
  var [confirmDisburse, setConfirmDisburse] = useState(null);
  // Refs let "Lock → Mark paid" and "Pay advance" actions auto-scroll the
  // proof uploader into view so the operator never has to hunt for it.
  var payFormRef = useRef(null);
  var advanceFormRef = useRef(null);
  // P1-2: openPayout request-token guard. Each click bumps the seq and the
  // in-flight request remembers its token; if a newer click landed by the
  // time the network resolves, every setDetail / setPayForm / setAdvanceForm
  // / setAdjustForm bails out so the user sees only the latest record.
  var openPayoutSeq = useRef(0);

  async function reloadList() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", String(PAYOUTS_LIMIT));
      if (periodFilter) qs.set("period", periodFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (employeeFilter) qs.set("employee_id", employeeFilter);
      var data = await request("/payouts?" + qs.toString(), null, auth.session);
      var prows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      setPayouts(prows);
      setPayoutsTotal(Number(data?.total ?? prows.length) || prows.length);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load payouts");
      setPayouts([]);
      setPayoutsTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function reloadUnpaidEmployees() {
    if (!auth.session?.access_token || !periodFilter) {
      setUnpaidEmployees({
        period: "",
        rows: [],
        total_pending: 0,
        loading: false,
        source: "rpc",
        error: ""
      });
      return;
    }
    setUnpaidEmployees(function (prev) {
      return { ...prev, loading: true, error: "" };
    });
    try {
      var qs = new URLSearchParams();
      qs.set("period", periodFilter);
      var data = await request(
        "/payouts/pending-employees?" + qs.toString(),
        null,
        auth.session
      );
      setUnpaidEmployees({
        period: data?.period || periodFilter,
        rows: Array.isArray(data?.rows) ? data.rows : [],
        total_pending: Number(data?.total_pending || 0),
        loading: false,
        source: data?.source || "rpc",
        error: ""
      });
    } catch (err) {
      // Don't blank the board on failure — surface the reason so the user
      // can act on it instead of staring at an empty table.
      setUnpaidEmployees({
        period: periodFilter,
        rows: [],
        total_pending: 0,
        loading: false,
        source: "rpc",
        error: err?.message || "Could not load unpaid employees"
      });
    }
  }

  async function reloadPending() {
    if (!auth.session?.access_token || !employeeFilter || !periodFilter) {
      setPending(null);
      return;
    }
    try {
      var qs = new URLSearchParams();
      qs.set("employee_id", employeeFilter);
      qs.set("period", periodFilter);
      var data = await request(
        "/payouts/pending?" + qs.toString(),
        null,
        auth.session
      );
      setPending(data || null);
    } catch (err) {
      setPending(null);
      setDetailError(err.message || "Could not load pending totals from duty calendar");
    }
  }

  async function loadAuditTrail(payoutId) {
    if (!payoutId || !auth.session?.access_token) {
      setAuditTrail([]);
      return;
    }
    try {
      var qs = new URLSearchParams();
      qs.set("module", "payout");
      qs.set("entity_id", payoutId);
      qs.set("limit", "100");
      var data = await request("/audits?" + qs.toString(), null, auth.session);
      var rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      // Oldest first so the PDF reads as a chronological audit log.
      rows.sort(function (a, b) {
        var at = new Date(a.created_at || 0).getTime();
        var bt = new Date(b.created_at || 0).getTime();
        return at - bt;
      });
      setAuditTrail(rows);
    } catch (err) {
      setAuditTrail([]);
      setDetailError(err.message || "Could not load accountability audit trail");
    }
  }

  async function openPayout(id) {
    setDetailError("");
    if (!id) {
      setDetail(null);
      setSelectedId("");
      setAuditTrail([]);
      return;
    }
    // P1-2: capture the request token BEFORE any await so a rapid second
    // click (or realtime-triggered re-open) cannot let the slower response
    // overwrite the latest row's detail/forms.
    openPayoutSeq.current += 1;
    var reqId = openPayoutSeq.current;
    setDetailLoading(true);
    setError("");
    try {
      var data = await request("/payouts/" + id, null, auth.session);
      if (reqId !== openPayoutSeq.current) return;
      setDetail(data);
      if (reqId !== openPayoutSeq.current) return;
      setSelectedId(id);
      loadAuditTrail(id);
      var row = data?.payout || {};
      if (reqId !== openPayoutSeq.current) return;
      if (!row.updated_at) {
        setMessage(
          "Legacy payout without server updated_at — save carefully; another user may have edited it."
        );
      }
      setAdjustForm({
        advance: Number(row.advance || 0),
        deduction: Number(row.deduction || 0),
        bonus: Number(row.bonus || 0),
        remarks: row.remarks || ""
      });
      if (reqId !== openPayoutSeq.current) return;
      setPayForm(emptyPayForm());
      if (reqId !== openPayoutSeq.current) return;
      setAdvanceForm(emptyAdvanceForm());
      var disbursementCount = Array.isArray(data?.paid_transactions)
        ? data.paid_transactions.length
        : 0;
      var openOutstanding = Number(data?.outstanding || row.net_amount || 0);
      if (reqId !== openPayoutSeq.current) return;
      setAdvanceOpen(
        String(row.status || "OPEN") === "OPEN" &&
          disbursementCount === 0 &&
          openOutstanding > 0
      );
    } catch (err) {
      if (reqId !== openPayoutSeq.current) return;
      setError(err.message || "Could not load payout detail");
      setDetail(null);
    } finally {
      if (reqId === openPayoutSeq.current) setDetailLoading(false);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reloadList();
      reloadPending();
      reloadUnpaidEmployees();
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          setEmployees(Array.isArray(rows) ? rows : []);
        })
        .catch(function () {
          setEmployees([]);
        });
    },
    [auth.session?.access_token, periodFilter, statusFilter, employeeFilter]
  );

  // Deep-link from duty calendar: if the URL carries ?employee_id=&period=
  // and a matching payout row already exists, auto-open it once the list
  // arrives so the user lands directly on the right record.
  useEffect(
    function () {
      var ep = searchParams?.get("employee_id");
      var pm = searchParams?.get("period");
      if (!ep || !pm) return;
      if (selectedId) return;
      var match = payouts.find(function (p) {
        return p.employee_id === ep && p.period_month === pm;
      });
      if (match) openPayout(match.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payouts, searchParams]
  );

  var totals = useMemo(
    function () {
      var net = 0;
      var paid = 0;
      var open = 0;
      payouts.forEach(function (p) {
        net += Number(p.net_amount || 0);
        if (String(p.status) === "PAID") paid += Number(p.net_amount || 0);
        if (String(p.status) === "OPEN") open += Number(p.net_amount || 0);
      });
      return { net: net, paid: paid, open: open };
    },
    [payouts]
  );

  // Search filter for the "Unpaid employees" board — match on name or ID
  // so the accountant can jump straight to the row they need to act on
  // instead of scrolling a long list.
  var filteredUnpaid = useMemo(
    function () {
      var rows = Array.isArray(unpaidEmployees.rows) ? unpaidEmployees.rows : [];
      var term = String(unpaidSearch || "").trim().toLowerCase();
      if (!term) return rows;
      return rows.filter(function (r) {
        var name = String(r.employee_name || "").toLowerCase();
        var id = String(r.employee_id || "").toLowerCase();
        return name.indexOf(term) >= 0 || id.indexOf(term) >= 0;
      });
    },
    [unpaidEmployees.rows, unpaidSearch]
  );

  // Same search behaviour on the main payout ledger so operators can
  // narrow by employee name or payout ref without re-typing the ID into
  // the existing employee_id filter.
  var filteredPayouts = useMemo(
    function () {
      var term = String(ledgerSearch || "").trim().toLowerCase();
      if (!term) return payouts;
      return payouts.filter(function (p) {
        var name = String(p.employee_name || "").toLowerCase();
        var id = String(p.employee_id || "").toLowerCase();
        var ref = String(p.id || "").toLowerCase();
        return (
          name.indexOf(term) >= 0 ||
          id.indexOf(term) >= 0 ||
          ref.indexOf(term) >= 0
        );
      });
    },
    [payouts, ledgerSearch]
  );

  function employeeDisplayName(id) {
    if (!id) return "";
    var emp = employees.find(function (e) {
      return e.id === id;
    });
    if (emp) return emp.full_name || emp.name || id;
    return id;
  }

  async function handleEnsure(event) {
    event.preventDefault();
    if (!canWrite) return;
    if (!ensureForm.employee_id) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var data = await requestWithOfflineFallback(
        "/payouts",
        {
          method: "POST",
          body: {
            employee_id: ensureForm.employee_id,
            period_month: ensureForm.period_month,
            advance: Number(ensureForm.advance || 0),
            deduction: Number(ensureForm.deduction || 0),
            bonus: Number(ensureForm.bonus || 0),
            remarks: ensureForm.remarks || ""
          }
        },
        auth.session
      );
      var ensuredName =
        data?.employee_name ||
        employeeDisplayName(ensureForm.employee_id) ||
        ensureForm.employee_id;
      setMessage("Payout ensured for " + ensuredName);
      setEnsureForm(emptyEnsureForm());
      await reloadList();
      await reloadUnpaidEmployees();
      if (data?.id) await openPayout(data.id);
    } catch (err) {
      setError(err.message || "Could not ensure payout");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(event) {
    event.preventDefault();
    if (!canDisburse) return;
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/adjust",
        {
          method: "POST",
          body: {
            payout_id: selectedId,
            advance: Number(adjustForm.advance || 0),
            deduction: Number(adjustForm.deduction || 0),
            bonus: Number(adjustForm.bonus || 0),
            remarks: adjustForm.remarks || ""
          }
        },
        auth.session
      );
      setMessage("Payout adjusted");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not adjust payout");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRate(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!canWrite) return;
    if (!payout) return;
    var rate = Number(rateRepairRate);
    if (!rate || rate <= 0) {
      setError("Enter a payout per day greater than 0");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/payouts/set-rate",
        {
          method: "POST",
          body: {
            employee_id: payout.employee_id,
            period: payout.period_month,
            payout_per_day: rate
          }
        },
        auth.session
      );
      setMessage(
        "Updated payout rate to ₹" +
          rate +
          "/day and refreshed " +
          employeeNameForDetail
      );
      setRateRepairRate("");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not update duty rates");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecompute() {
    if (!canWrite) return;
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/recompute",
        { method: "POST", body: {} },
        auth.session
      );
      setMessage("Payout recomputed from duty + attendance");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not recompute");
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!canWrite) return;
    if (!selectedId) return;
    var reason = String(lockReason || "").trim();
    if (!reason) {
      setError("Enter a reason for locking this payout before payment");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/lock",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      setMessage(
        "Payout locked. Attach a payment-proof image below and click 'Mark as paid' to generate the receipt PDF."
      );
      await openPayout(selectedId);
      await reloadList();
      // The "Mark as paid" form only renders once status is LOCKED, so we
      // scroll on the next tick after React commits the new DOM.
      window.setTimeout(function () {
        if (payFormRef.current && typeof payFormRef.current.scrollIntoView === "function") {
          payFormRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 80);
    } catch (err) {
      setError(err.message || "Could not lock");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!canReopen) return;
    if (!selectedId) return;
    var reason = String(reopenReason || "").trim();
    if (!reason) {
      setError("Enter a reason for reopening this locked payout");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/reopen",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      setMessage("Payout reopened");
      await openPayout(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not reopen");
    } finally {
      setBusy(false);
    }
  }

  async function handleProofUpload(target, files) {
    if (!files || !files[0]) return;
    var file = files[0];
    setBusy(true);
    setError("");
    try {
      // P1-36: proof belongs to the employee being paid. payForm.employee_id
      // and advanceForm.employee_id are both required by the form so it
      // should always be present here; we fall back to a draft id for safety.
      var employeeId =
        target === "pay"
          ? payForm.employee_id
          : advanceForm.employee_id;
      var resourceId = employeeId || "draft-" + Math.random().toString(36).slice(2);
      var uploaded = await uploadDocument({
        bucket: "payout-proofs",
        file: file,
        session: auth.session,
        supabase: auth.supabase,
        resource: "Employees",
        resourceId: resourceId
      });
      // Cache an object URL so the preview tile renders the picture/PDF
      // immediately — no extra round-trip to Supabase storage required.
      var previewUrl = null;
      try {
        if (typeof window !== "undefined" && window.URL && file) {
          previewUrl = window.URL.createObjectURL(file);
          if (previewUrl) proofObjectUrlsRef.current.push(previewUrl);
        }
      } catch (_e) {
        previewUrl = null;
      }
      var enriched = {
        ...uploaded,
        preview_url: previewUrl,
        mime: file.type || "",
        size: file.size || 0
      };
      if (target === "pay") {
        setPayForm(function (f) {
          // P1-29: if an old proof was attached, release its blob URL first.
          disposeProofObjectUrl(f.proof);
          return { ...f, proof: enriched };
        });
      } else {
        setAdvanceForm(function (f) {
          disposeProofObjectUrl(f.proof);
          return { ...f, proof: enriched };
        });
      }
      setMessage("Proof attached: " + uploaded.file_name);
    } catch (err) {
      setError(err.message || "Could not upload proof");
    } finally {
      setBusy(false);
    }
  }

  // Visual preview tile for an attached payout proof. Renders an inline
  // <img> when the upload looks like an image, otherwise a PDF/file
  // confirmation card. The empty state explicitly demands a photo so
  // the accountant cannot miss the requirement.
  function ProofPreview(props) {
    var proof = props && props.proof;
    if (!proof) {
      return (
        <div
          style={{
            marginTop: 6,
            padding: "10px 12px",
            border: "2px dashed #f59e0b",
            background: "#fff7ed",
            borderRadius: 6,
            color: "#9a3412",
            fontSize: 13
          }}
        >
          📷 <strong>Photo of payment proof is required</strong> — bank slip,
          UPI screenshot, signed cash receipt, or any document confirming
          this disbursement. The server rejects submissions without proof.
        </div>
      );
    }
    var url = proof.preview_url || "";
    var name = proof.file_name || proof.path || "Attached";
    var lower = String(name).toLowerCase();
    var isImage =
      /^image\//i.test(String(proof.mime || "")) ||
      /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(lower);
    return (
      <div
        style={{
          marginTop: 6,
          padding: 10,
          border: "1px solid #16a34a",
          background: "#f0fdf4",
          borderRadius: 6
        }}
      >
        <div style={{ fontWeight: 600, color: "#166534", fontSize: 13 }}>
          ✓ Proof attached
        </div>
        {url && isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={name}
            style={{
              display: "block",
              marginTop: 6,
              maxWidth: "100%",
              maxHeight: 220,
              borderRadius: 4,
              border: "1px solid #bbf7d0"
            }}
          />
        ) : (
          <div style={{ marginTop: 4, color: "#166534", fontSize: 12 }}>
            📄 {name}
          </div>
        )}
        <div style={{ marginTop: 4, color: "#475569", fontSize: 11 }}>
          {name}
        </div>
      </div>
    );
  }

  async function handlePay(event) {
    event.preventDefault();
    if (!canDisburse) return;
    if (!selectedId) return;
    if (!payForm.proof) {
      setError("Attach a payout proof before marking paid");
      return;
    }
    if (confirmDisburse !== "pay") {
      setConfirmDisburse("pay");
      setError("");
      setMessage("Review the payment summary below, then confirm to mark as paid.");
      return;
    }
    setConfirmDisburse(null);
    setBusy(true);
    setError("");
    try {
      var body = {
        payout_id: selectedId,
        paid_on: payForm.paid_on,
        method: payForm.method,
        remarks: payForm.remarks || "",
        proof_bucket: payForm.proof.bucket,
        proof_path: payForm.proof.path,
        photo: payForm.proof.file_name || ""
      };
      if (payForm.amount && Number(payForm.amount) > 0) {
        body.amount = Number(payForm.amount);
      }
      await requestWithOfflineFallback(
        "/payouts/pay",
        { method: "POST", body: body },
        auth.session
      );
      setMessage(
        "Payout marked PAID. Receipt PDF (with embedded payment-proof image) is ready in Disbursements below — click 'Receipt PDF' to print or save."
      );
      setPayForm(emptyPayForm());
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not mark paid");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance(event) {
    event.preventDefault();
    if (!canDisburse) return;
    if (!selectedId) return;
    if (!advanceForm.amount || Number(advanceForm.amount) <= 0) {
      setError("Advance amount must be greater than zero");
      return;
    }
    if (!advanceForm.proof) {
      setError("Attach a payout proof before recording advance");
      return;
    }
    if (confirmDisburse !== "advance") {
      setConfirmDisburse("advance");
      setError("");
      setMessage("Review the advance summary below, then confirm to record.");
      return;
    }
    setConfirmDisburse(null);
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/pay-advance",
        {
          method: "POST",
          body: {
            payout_id: selectedId,
            amount: Number(advanceForm.amount),
            paid_on: advanceForm.paid_on,
            method: advanceForm.method,
            remarks: advanceForm.remarks || "",
            proof_bucket: advanceForm.proof.bucket,
            proof_path: advanceForm.proof.path,
            photo: advanceForm.proof.file_name || ""
          }
        },
        auth.session
      );
      setMessage(
        "Advance recorded. Receipt PDF (with embedded payment-proof image) is ready in Disbursements below — click 'Receipt PDF' to print or save."
      );
      setAdvanceForm(emptyAdvanceForm());
      setAdvanceOpen(false);
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not record advance");
    } finally {
      setBusy(false);
    }
  }

  async function viewProof(tx) {
    if (!tx?.proof_bucket || !tx?.proof_path) return;
    try {
      var signed = await getDocumentSignedUrl(
        { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
        auth.session
      );
      if (signed?.signedUrl) {
        window.open(signed.signedUrl, "_blank", "noopener");
      } else {
        setError("Proof is not accessible");
      }
    } catch (err) {
      setError(err.message || "Could not open proof");
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function buildProofHtmlForTx(tx) {
    if (!tx?.proof_bucket || !tx?.proof_path) {
      return "<div class='meta' style='color:#b91c1c'><strong>No payment proof attached.</strong></div>";
    }
    try {
      var signed = await getDocumentSignedUrl(
        { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
        auth.session
      );
      var url = signed && signed.signedUrl;
      var lower = String(tx.photo || tx.proof_path || "").toLowerCase();
      var isImage = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(lower);
      if (url && isImage) {
        return (
          "<div style='margin:6px 0'>" +
          "<img src='" +
          url +
          "' alt='Payment proof' style='max-width:100%;max-height:420px;border:1px solid #dbe3ee;border-radius:6px'/>" +
          "</div>" +
          "<div class='meta'>Source: " +
          escapeHtml(tx.photo || tx.proof_path) +
          "</div>"
        );
      }
      if (url) {
        return (
          "<div class='meta'>File: " +
          escapeHtml(tx.photo || tx.proof_path) +
          "</div>" +
          "<div class='meta'><a href='" +
          url +
          "' target='_blank'>Open proof in new tab</a></div>"
        );
      }
      return (
        "<div class='meta'>Reference: " +
        escapeHtml(tx.photo || tx.proof_path) +
        " (signing failed)</div>"
      );
    } catch (err) {
      return (
        "<div class='meta'>Reference: " +
        escapeHtml(tx.photo || tx.proof_path) +
        " (" +
        escapeHtml(err.message || "could not fetch signed URL") +
        ")</div>"
      );
    }
  }

  async function printPayout() {
    if (!detail?.payout) return;
    var row = detail.payout;
    var name = row.employee_name || employeeDisplayName(row.employee_id);
    var paidRows = Array.isArray(detail.paid_transactions)
      ? detail.paid_transactions
      : [];
    var paidTable = paidRows.length
      ? "<table><thead><tr><th>Serial</th><th>Kind</th><th>Date</th><th>Method</th><th>Amount</th><th>Proof</th><th>Recorded by</th></tr></thead><tbody>" +
        paidRows
          .map(function (t) {
            var hasProof = !!(t.proof_bucket && t.proof_path);
            return (
              "<tr><td>" +
              escapeHtml(t.serial_no || t.id) +
              "</td><td>" +
              escapeHtml(t.tx_kind || "FINAL") +
              "</td><td>" +
              escapeHtml(t.paid_on || "") +
              "</td><td>" +
              escapeHtml(t.method || "") +
              "</td><td>" +
              formatCurrency(t.amount) +
              "</td><td>" +
              (hasProof
                ? "<span style='color:#15803d'>✓ on file</span>"
                : "<span style='color:#b91c1c'>missing</span>") +
              "</td><td>" +
              escapeHtml(t.created_by || "—") +
              (t.created_at ? "<br/><span style='color:#64748b;font-size:10px'>" + escapeHtml(formatDate(t.created_at)) + "</span>" : "") +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";

    var pb = Array.isArray(detail.patient_breakdown)
      ? detail.patient_breakdown
      : [];
    var patientTable = pb.length
      ? "<table><thead><tr><th>#</th><th>Patient</th><th>Days present</th><th>Hours</th><th>Charged days</th><th>Window</th><th>Amount</th></tr></thead><tbody>" +
        pb
          .map(function (p, idx) {
            return (
              "<tr><td>" +
              (idx + 1) +
              "</td><td>" +
              escapeHtml(p.patient_name || p.patient_id) +
              "</td><td>" +
              (p.days_worked || 0) +
              "</td><td>" +
              (p.hours || 0) +
              "</td><td>" +
              (p.charged_days || 0) +
              "</td><td>" +
              escapeHtml(
                (p.first_date || "-") + " → " + (p.last_date || "-")
              ) +
              "</td><td>" +
              formatCurrency(p.amount) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";

    // Duty-by-duty employee work description. Auditors need to see exactly
    // *what* the payout is paying for: the assignment, the patient, the
    // shift, the date window, and the per-day rates. We reuse the duty
    // rows already loaded by the service and look up patient names from
    // the breakdown roll-up so the PDF stays accurate without an extra
    // round-trip.
    var dutyRows = Array.isArray(detail.duties) ? detail.duties : [];
    var patientNameById = {};
    pb.forEach(function (p) {
      if (p && p.patient_id) {
        patientNameById[String(p.patient_id)] = p.patient_name || p.patient_id;
      }
    });
    function shortDate(value) {
      if (!value) return "—";
      try {
        var s = String(value);
        if (s.length >= 10) return s.slice(0, 10);
        return s;
      } catch (_e) {
        return String(value || "—");
      }
    }
    var workLogTable = dutyRows.length
      ? "<table><thead><tr><th>#</th><th>Duty ID</th><th>Patient</th><th>Service</th><th>Shift</th><th>From</th><th>To</th><th>Status</th><th>Charge/day</th><th>Payout/day</th></tr></thead><tbody>" +
        dutyRows
          .map(function (d, idx) {
            var pid = String(d.patient_id || "");
            return (
              "<tr><td>" +
              (idx + 1) +
              "</td><td>" +
              escapeHtml(String(d.id || "—")) +
              "</td><td>" +
              escapeHtml(patientNameById[pid] || pid || "—") +
              "</td><td>" +
              escapeHtml(String(d.service_name || d.service_type || "—")) +
              "</td><td>" +
              escapeHtml(String(d.shift_type || "—")) +
              "</td><td>" +
              escapeHtml(shortDate(d.start_at)) +
              "</td><td>" +
              escapeHtml(shortDate(d.end_at)) +
              "</td><td>" +
              escapeHtml(String(d.status || "—")) +
              "</td><td>" +
              formatCurrency(d.charge_per_day) +
              "</td><td>" +
              formatCurrency(d.payout_per_day) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";

    var auditHeader =
      "<div class='meta' style='color:#475569;font-size:11px'>" +
      "Created by " + escapeHtml(row.created_by || "—") +
      (row.created_at ? " on " + escapeHtml(formatDate(row.created_at)) : "") +
      " · Last updated by " + escapeHtml(row.updated_by || row.created_by || "—") +
      (row.updated_at ? " on " + escapeHtml(formatDate(row.updated_at)) : "") +
      (String(row.status) === "PAID" && row.paid_at
        ? " · Settled on " + escapeHtml(formatDate(row.paid_at))
        : "") +
      "</div>";

    // Detailed accountability section — chronological audit trail of every
    // mutation persisted in `hh_audit_log` for this payout. Falls back to
    // the row-level created/updated stamps when the audit log endpoint
    // returns nothing (e.g. legacy rows pre-audit).
    var trail = Array.isArray(auditTrail) ? auditTrail : [];
    var auditRowsHtml = trail.length
      ? trail
          .map(function (a) {
            return (
              "<tr><td>" +
              escapeHtml(a.created_at ? formatDate(a.created_at) : "—") +
              "</td><td>" +
              escapeHtml(String(a.action || "")) +
              "</td><td>" +
              escapeHtml(a.actor || "—") +
              "</td><td>" +
              escapeHtml(a.stamp || "") +
              "</td></tr>"
            );
          })
          .join("")
      : "<tr><td colspan='4' style='color:#64748b'>No audit log entries returned for this payout (legacy row).</td></tr>";
    var auditTable =
      "<h3>Accountability — audit trail</h3>" +
      "<table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Notes</th></tr></thead><tbody>" +
      auditRowsHtml +
      "</tbody></table>";

    var body =
      "<h2>Payout Statement</h2>" +
      "<div class='meta'><strong>Employee:</strong> " +
      escapeHtml(name || "—") +
      "</div>" +
      "<div class='meta'><strong>Period:</strong> " +
      escapeHtml(row.period_month) +
      "</div>" +
      "<div class='meta'><strong>Status:</strong> " +
      escapeHtml(row.status) +
      "</div>" +
      "<div class='meta'><strong>Payout ref:</strong> " +
      escapeHtml(row.id) +
      "</div>" +
      auditHeader +
      "<h3>Amount summary</h3>" +
      "<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>" +
      "<tr><td>Gross</td><td>" + formatCurrency(row.gross_amount) + "</td></tr>" +
      "<tr><td>Duty count</td><td>" + (row.duty_count || 0) + "</td></tr>" +
      "<tr><td>Hours</td><td>" + (row.hours || 0) + "</td></tr>" +
      "<tr><td>Advance (adj)</td><td>" + formatCurrency(row.advance) + "</td></tr>" +
      "<tr><td>Deduction</td><td>" + formatCurrency(row.deduction) + "</td></tr>" +
      "<tr><td>Bonus</td><td>" + formatCurrency(row.bonus) + "</td></tr>" +
      "<tr><td><strong>Net</strong></td><td><strong>" + formatCurrency(row.net_amount) + "</strong></td></tr>" +
      "<tr><td>Paid so far</td><td>" + formatCurrency(detail.paid_total || 0) + "</td></tr>" +
      "<tr><td>Outstanding</td><td>" + formatCurrency(detail.outstanding || 0) + "</td></tr>" +
      "</tbody></table>" +
      (patientTable
        ? "<h3>Patients worked (" + pb.length + ")</h3>" + patientTable
        : "") +
      (workLogTable
        ? "<h3>Employee work description — duty-by-duty (" +
          dutyRows.length +
          ")</h3>" +
          "<div class='meta' style='color:#475569;font-size:11px;margin-bottom:4px'>Each row is one assignment in the duty calendar. Charge/day and Payout/day are the rates the duty was logged with at time of work.</div>" +
          workLogTable
        : "") +
      (paidTable ? "<h3>Disbursements (" + paidRows.length + ")</h3>" + paidTable : "<h3>Disbursements</h3><div class='meta' style='color:#b91c1c'>No disbursements recorded yet for this payout.</div>");

    var proofBundle = "";
    for (var pi = 0; pi < paidRows.length; pi += 1) {
      var ptx = paidRows[pi];
      if (!ptx.proof_bucket || !ptx.proof_path) continue;
      proofBundle +=
        "<h3>Payment proof — " +
        escapeHtml(ptx.serial_no || ptx.id || "disbursement") +
        "</h3>" +
        (await buildProofHtmlForTx(ptx));
    }

    body +=
      proofBundle +
      (row.paid_at ? "<div class='meta'><strong>Paid on:</strong> " + formatDate(row.paid_at) + "</div>" : "") +
      (row.remarks ? "<div class='meta'><strong>Remarks:</strong> " + escapeHtml(row.remarks) + "</div>" : "") +
      auditTable;
    openPrintWindow("Payout " + row.id, body);
  }

  // One-receipt-per-transaction PDF. Includes serial, employee name, payout
  // ref, method, amount, remarks, the per-patient breakdown for the period
  // (so the receipt explains "this ₹X is for N days across M patients"),
  // and the payment proof embedded as an image when the proof is an image
  // file. PDF proofs are linked instead of embedded — print engines vary
  // wildly on cross-doc embedding.
  async function printReceipt(tx) {
    if (!tx) return;
    var row = detail?.payout || null;
    var name = row
      ? row.employee_name || employeeDisplayName(row.employee_id)
      : employeeDisplayName(tx.employee_id || "");
    var period = row?.period_month || tx.period_month || "";
    var kindLabel = String(tx.tx_kind || "FINAL") === "ADVANCE" ? "Advance Receipt" : "Payout Receipt";

    var rows = [
      ["Receipt no", tx.serial_no || tx.id || ""],
      ["Type", tx.tx_kind || "FINAL"],
      ["Employee", name || "—"],
      ["Period", period],
      ["Paid on", tx.paid_on || ""],
      ["Method", tx.method || ""],
      ["Amount", formatCurrency(tx.amount)],
      ["Payout ref", row ? row.id : "-"],
      ["Remarks", tx.remarks || "-"],
      [
        "Recorded by",
        (tx.created_by || "—") +
          (tx.created_at ? " on " + formatDate(tx.created_at) : "")
      ],
      tx.updated_by && tx.updated_by !== tx.created_by
        ? ["Last edited by", tx.updated_by]
        : null
    ].filter(Boolean);
    var rowsHtml = rows
      .map(function (pair) {
        return (
          "<tr><th style='width:35%'>" +
          escapeHtml(pair[0]) +
          "</th><td>" +
          (pair[1] === null || pair[1] === undefined ? "" : escapeHtml(pair[1])) +
          "</td></tr>"
        );
      })
      .join("");

    // Patient × days table — directly answers "this receipt was earned
    // working with which patient(s) for how many days?"
    var pbAll = Array.isArray(detail?.patient_breakdown)
      ? detail.patient_breakdown
      : [];
    var pb = pbAll.filter(function (p) {
      return Number(p.days_worked || 0) > 0 || Number(p.amount || 0) > 0;
    });
    var patientTable = pb.length
      ? "<h3>Days worked this period (" + pb.length + " patient" + (pb.length === 1 ? "" : "s") + ")</h3>" +
        "<table><thead><tr><th>#</th><th>Patient</th><th>Days present</th><th>Hours</th><th>Window</th><th>Amount</th></tr></thead><tbody>" +
        pb
          .map(function (p, idx) {
            return (
              "<tr><td>" +
              (idx + 1) +
              "</td><td>" +
              escapeHtml(p.patient_name || p.patient_id) +
              "</td><td>" +
              (p.days_worked || 0) +
              "</td><td>" +
              (p.hours || 0) +
              "</td><td>" +
              escapeHtml((p.first_date || "-") + " → " + (p.last_date || "-")) +
              "</td><td>" +
              formatCurrency(p.amount) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";

    // Resolve the proof into a signed URL + decide whether to embed as
    // <img> (images) or link (PDFs / unknown types). Failures are non-fatal
    // — the receipt still prints with a "proof on file" note so the user
    // can save the PDF and attach the proof manually if needed.
    var proofHtml = "";
    if (tx.proof_bucket && tx.proof_path) {
      try {
        var signed = await getDocumentSignedUrl(
          { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
          auth.session
        );
        var url = signed && signed.signedUrl;
        var lower = String(tx.photo || tx.proof_path || "").toLowerCase();
        var isImage = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(lower);
        if (url && isImage) {
          proofHtml =
            "<h3>Payment proof</h3>" +
            "<div style='margin:6px 0'>" +
            "<img src='" + url + "' alt='Payment proof' style='max-width:100%;max-height:520px;border:1px solid #dbe3ee;border-radius:6px'/>" +
            "</div>" +
            "<div class='meta'>Source: " + escapeHtml(tx.photo || tx.proof_path) + "</div>";
        } else if (url) {
          proofHtml =
            "<h3>Payment proof</h3>" +
            "<div class='meta'>File: " + escapeHtml(tx.photo || tx.proof_path) + "</div>" +
            "<div class='meta'><a href='" + url + "' target='_blank'>Open proof in new tab</a></div>";
        } else {
          proofHtml =
            "<h3>Payment proof</h3>" +
            "<div class='meta'>Reference: " + escapeHtml(tx.photo || tx.proof_path) + " (signing failed — open from the disbursement row).</div>";
        }
      } catch (err) {
        proofHtml =
          "<h3>Payment proof</h3>" +
          "<div class='meta'>Reference: " + escapeHtml(tx.photo || tx.proof_path) + " (" + escapeHtml(err.message || "could not fetch signed URL") + ")</div>";
      }
    } else {
      proofHtml = "<div class='meta' style='color:#b91c1c'><strong>No payment proof was attached.</strong></div>";
    }

    var body =
      "<h2>" + kindLabel + "</h2>" +
      "<table><tbody>" + rowsHtml + "</tbody></table>" +
      patientTable +
      proofHtml +
      "<div class='stamp'>I confirm I have received the above amount from Hominal Healthcare Pvt Ltd.</div>";

    openPrintWindow(kindLabel + " " + (tx.serial_no || tx.id || ""), body);
  }

  function startEnsureForEmployee(empId, period) {
    if (!canWrite) return;
    setEnsureForm(function (prev) {
      return {
        ...prev,
        employee_id: empId || prev.employee_id,
        period_month: period || prev.period_month || currentPeriod()
      };
    });
    setMessage("Pre-filled ensure form for " + employeeDisplayName(empId));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  var payout = detail?.payout || null;
  var status = String(payout?.status || "OPEN");
  var permissions = detail?.permissions || {
    canAdjust: false,
    canLock: false,
    canReopen: false,
    canPayFinal: false,
    canPayAdvance: false
  };
  var isPaid = status === "PAID";
  var paidTransactions = Array.isArray(detail?.paid_transactions)
    ? detail.paid_transactions
    : [];
  var outstanding = Number(detail?.outstanding || 0);
  var paidTotal = Number(detail?.paid_total || 0);
  var employeeNameForDetail = payout
    ? payout.employee_name || employeeDisplayName(payout.employee_id)
    : "";
  var diagnostics = detail?.diagnostics || null;
  var patientBreakdown = Array.isArray(detail?.patient_breakdown)
    ? detail.patient_breakdown
    : [];
  var multiPatient = patientBreakdown.length > 1;

  return (
    <AuthGuard permission="payouts.read">
      <AppShell title="Payouts">
        <div className="page-split">
          <div className="page-grid">
            {unpaidEmployees.rows.length > 0 ? (
              <div
                className="helper-box"
                style={{
                  background: "#fff7ed",
                  border: "2px solid #ea580c",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 8
                }}
              >
                <div
                  className="button-row"
                  style={{ justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#9a3412" }}>
                      ⚠️ {unpaidEmployees.rows.length} unpaid employee
                      {unpaidEmployees.rows.length === 1 ? "" : "s"} for{" "}
                      {unpaidEmployees.period || periodFilter || ""}
                    </div>
                    <div style={{ fontSize: 13, color: "#7c2d12", marginTop: 2 }}>
                      Total pending{" "}
                      <strong>{formatCurrency(unpaidEmployees.total_pending)}</strong>{" "}
                      sourced from the duty calendar. Search and pay them below.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button primary"
                    onClick={function () {
                      if (
                        unpaidPanelRef.current &&
                        typeof unpaidPanelRef.current.scrollIntoView === "function"
                      ) {
                        unpaidPanelRef.current.scrollIntoView({
                          behavior: "smooth",
                          block: "start"
                        });
                      }
                    }}
                  >
                    Jump to unpaid list →
                  </button>
                </div>
              </div>
            ) : null}
            {canWrite ? (
            <ModuleShell title="Ensure / recompute" description="Recompute gross from duty + attendance and apply advance / deduction / bonus.">
              <form className="stack" onSubmit={handleEnsure}>
                <div className="grid-2">
                  <div className="field">
                    <label>Employee</label>
                    <select
                      value={ensureForm.employee_id}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, employee_id: event.target.value });
                      }}
                      required
                    >
                      <option value="">Select employee</option>
                      {employees.map(function (e) {
                        return (
                          <option key={e.id} value={e.id}>
                            {e.full_name || e.name || e.id}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Period (YYYY-MM)</label>
                    <input
                      type="month"
                      value={ensureForm.period_month}
                      onChange={function (event) {
                        var v = event.target.value;
                        // P1-17: never trust the keyboard. Some browsers still
                        // let you free-type into a type="month" input, and a
                        // stray ":" or "13" got serialized straight into
                        // hh_payouts.period_month, breaking every downstream
                        // group-by. Validate against the strict month regex.
                        if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return;
                        setEnsureForm({ ...ensureForm, period_month: v });
                      }}
                      placeholder={currentPeriod()}
                      pattern="\d{4}-(0[1-9]|1[0-2])"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Advance</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.advance}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, advance: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Deduction</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.deduction}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, deduction: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Bonus</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.bonus}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, bonus: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Remarks</label>
                    <input
                      value={ensureForm.remarks}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, remarks: event.target.value });
                      }}
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy || !ensureForm.employee_id}>
                    {busy ? "Saving…" : "Ensure payout"}
                  </button>
                </div>
              </form>
            </ModuleShell>
            ) : (
              <ModuleShell title="Ensure / recompute" description="Read-only access — contact Admin, Manager, or Accountant to create payouts.">
                <div className="helper-box">
                  You can view payouts and pending totals. Only Admin, Manager, and Accountant can
                  ensure or lock; only Admin and Accountant can pay or adjust.
                </div>
              </ModuleShell>
            )}

            {pending ? (
              <ModuleShell
                title={"Pending from duty calendar — " + pending.employee_name}
                description="Live total of partner pending payout for the selected period, sourced from hh_payout_charges minus disbursements."
              >
                <div className="grid-2">
                  <div>
                    <strong>Period:</strong> {pending.period}
                  </div>
                  <div>
                    <strong>Duties:</strong> {pending.duty_count}
                  </div>
                  <div>
                    <strong>Charged:</strong> {formatCurrency(pending.charged)}
                  </div>
                  <div>
                    <strong>Paid:</strong> {formatCurrency(pending.paid)}
                  </div>
                  <div>
                    <strong>Pending:</strong>{" "}
                    <span className={pending.pending > 0 ? "status open" : "status paid"}>
                      {formatCurrency(pending.pending)}
                    </span>
                  </div>
                  <div>
                    <strong>Payout row:</strong>{" "}
                    {pending.payout
                      ? pending.payout.status + " · " + pending.payout.id
                      : "Not yet ensured"}
                  </div>
                </div>
                {Array.isArray(pending.paid_transactions) && pending.paid_transactions.length ? (
                  <div className="stack" style={{ marginTop: 12 }}>
                    <strong>Disbursements this period ({pending.paid_transactions.length})</strong>
                    <div className="record-list">
                      {pending.paid_transactions.map(function (tx) {
                        return (
                          <div key={tx.id} className="record-card">
                            <div className="record-meta">
                              <span>{tx.serial_no || tx.id}</span>
                              <span>{tx.tx_kind || "FINAL"}</span>
                              <span>{tx.paid_on || ""}</span>
                              <span>{formatCurrency(tx.amount)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </ModuleShell>
            ) : null}

            <div ref={unpaidPanelRef} />
            <ModuleShell
              title={"Unpaid employees — " + (unpaidEmployees.period || periodFilter || "")}
              description="Every employee with outstanding payout balance for this period (charged in duty calendar minus disbursements). Click to ensure or open the payout."
            >
              <div
                className="button-row"
                style={{ marginBottom: 6, alignItems: "center", gap: 8 }}
              >
                <input
                  type="search"
                  value={unpaidSearch}
                  onChange={function (event) {
                    setUnpaidSearch(event.target.value);
                  }}
                  placeholder="🔍 Search unpaid by employee name or ID"
                  style={{
                    flex: 1,
                    minWidth: 240,
                    padding: "6px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6
                  }}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={reloadUnpaidEmployees}
                  disabled={unpaidEmployees.loading}
                  title="Re-read duty calendar charges and disbursements"
                >
                  {unpaidEmployees.loading ? "Refreshing…" : "Refresh from duty calendar"}
                </button>
                {unpaidEmployees.source === "fallback" ? (
                  <span className="mini-muted" title="Running in fallback mode — migration 043 (hh_employees_pending_for_period) is missing on Supabase. Apply it for faster aggregation.">
                    ⚠️ Fallback mode — apply migration 043 for native aggregation
                  </span>
                ) : null}
              </div>
              {unpaidEmployees.error ? (
                <div className="error-text" style={{ marginBottom: 6 }}>
                  {unpaidEmployees.error}
                </div>
              ) : null}
              <div className="helper-box">
                {unpaidEmployees.loading
                  ? "Loading…"
                  : unpaidEmployees.rows.length === 0
                  ? "All employees fully paid for this period."
                  : unpaidSearch && filteredUnpaid.length !== unpaidEmployees.rows.length
                  ? filteredUnpaid.length +
                    " of " +
                    unpaidEmployees.rows.length +
                    " unpaid employee" +
                    (unpaidEmployees.rows.length === 1 ? "" : "s") +
                    " match '" +
                    unpaidSearch +
                    "' · Total pending " +
                    formatCurrency(unpaidEmployees.total_pending)
                  : unpaidEmployees.rows.length +
                    " employee" +
                    (unpaidEmployees.rows.length === 1 ? "" : "s") +
                    " · Total pending " +
                    formatCurrency(unpaidEmployees.total_pending)}
              </div>
              {filteredUnpaid.length ? (
                <div className="record-list">
                  {filteredUnpaid.map(function (row) {
                    var statusLabel = row.payout_status || "UNPAID";
                    return (
                      <div key={row.employee_id} className="record-card">
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>
                              {row.employee_name &&
                              row.employee_name !== row.employee_id
                                ? row.employee_name
                                : employeeDisplayName(row.employee_id) ||
                                  "Employee"}
                            </h3>
                            <div className="record-meta">
                              <span>{row.duty_count || 0} duties</span>
                              <span>Charged {formatCurrency(row.charged)}</span>
                              <span>Paid {formatCurrency(row.paid)}</span>
                              <span>
                                <strong>Pending {formatCurrency(row.pending)}</strong>
                              </span>
                            </div>
                          </div>
                          <div className="button-row">
                            <span className={"status " + String(statusLabel).toLowerCase()}>
                              {statusLabel}
                            </span>
                            {row.payout_id ? (
                              <button
                                type="button"
                                className="button secondary"
                                onClick={function () {
                                  setEmployeeFilter(row.employee_id);
                                  openPayout(row.payout_id);
                                }}
                              >
                                Open
                              </button>
                            ) : canWrite ? (
                              <button
                                type="button"
                                className="button primary"
                                onClick={function () {
                                  startEnsureForEmployee(
                                    row.employee_id,
                                    unpaidEmployees.period || periodFilter
                                  );
                                }}
                              >
                                Ensure
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : unpaidSearch && unpaidEmployees.rows.length ? (
                <div className="helper-box" style={{ color: "#b91c1c" }}>
                  No unpaid employees match &ldquo;{unpaidSearch}&rdquo;. Clear the
                  search to see all {unpaidEmployees.rows.length}.
                </div>
              ) : null}
            </ModuleShell>

            <ModuleShell title="Payout ledger" description="hh_payouts month view. Filter by period, status, or employee.">
              <div className="toolbar">
                <div className="field">
                  <label>Period</label>
                  <input
                    type="month"
                    value={periodFilter}
                    onChange={function (event) {
                      var v = event.target.value;
                      if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return;
                      setPeriodFilter(v);
                    }}
                    placeholder="YYYY-MM"
                    pattern="\d{4}-(0[1-9]|1[0-2])"
                  />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={statusFilter}
                    onChange={function (event) {
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="">All</option>
                    {PAYOUT_STATUS_OPTIONS.map(function (o) {
                      return (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Employee</label>
                  <select
                    value={employeeFilter}
                    onChange={function (event) {
                      setEmployeeFilter(event.target.value);
                    }}
                  >
                    <option value="">All</option>
                    {employees.map(function (e) {
                      return (
                        <option key={e.id} value={e.id}>
                          {e.full_name || e.name || e.id}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label>Search</label>
                  <input
                    type="search"
                    value={ledgerSearch}
                    onChange={function (event) {
                      setLedgerSearch(event.target.value);
                    }}
                    placeholder="Name, employee ID, or payout ref"
                  />
                </div>
                <div className="field">
                  <span aria-hidden="true">&nbsp;</span>
                  <button className="button secondary" type="button" onClick={reloadList}>
                    Refresh
                  </button>
                </div>
              </div>
              <div className="helper-box">
                Net {formatCurrency(totals.net)} &nbsp;·&nbsp; Paid {formatCurrency(totals.paid)} &nbsp;·&nbsp;
                Open {formatCurrency(totals.open)}
                {ledgerSearch && filteredPayouts.length !== payouts.length
                  ? " · Showing " + filteredPayouts.length + " of " + payouts.length
                  : ""}
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              {payouts.length >= PAYOUTS_LIMIT && payoutsTotal > payouts.length ? (
                <div className="info-text" role="status" style={{ background: "#fff7e6", border: "1px solid #ffd28d", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                  Showing first {payouts.length} of {payoutsTotal} payouts — refine filters to narrow the list.
                </div>
              ) : null}
              {!payouts.length ? (
                <EmptyState
                  title={loading ? "Loading…" : "No payouts"}
                  description="Ensure a payout above to start the period for this employee."
                />
              ) : !filteredPayouts.length ? (
                <EmptyState
                  title={"No matches for \u201c" + ledgerSearch + "\u201d"}
                  description="Clear the search to see all payouts."
                />
              ) : (
                <div className="record-list">
                  {filteredPayouts.map(function (row) {
                    var name = row.employee_name || employeeDisplayName(row.employee_id);
                    var isSelected = selectedId === row.id;
                    return (
                      <div
                        key={row.id}
                        className={"record-card" + (isSelected ? " selected" : "")}
                        role="button"
                        tabIndex={0}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={function () {
                          openPayout(row.id);
                        }}
                        onKeyDown={function (event) {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPayout(row.id);
                          }
                        }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{name || "Employee"}</h3>
                            <div
                              className="mini-muted"
                              style={{ fontSize: 11, marginTop: 1 }}
                            >
                              Ref {row.id}
                            </div>
                            <div className="record-meta">
                              <span>{row.period_month}</span>
                              <span>Net {formatCurrency(row.net_amount)}</span>
                              <span>
                                {row.duty_count || 0} duties · {row.hours || 0}h
                              </span>
                            </div>
                            <div
                              className="mini-muted"
                              style={{ fontSize: 11, marginTop: 2 }}
                            >
                              {row.created_by
                                ? "Created by " + row.created_by
                                : ""}
                              {row.updated_by && row.updated_by !== row.created_by
                                ? " · last edited by " + row.updated_by
                                : ""}
                            </div>
                          </div>
                          <span className={"status " + String(row.status || "open").toLowerCase()}>
                            {row.status || "OPEN"}
                          </span>
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
              title={payout ? employeeNameForDetail + " · " + payout.period_month : "Payout detail"}
              description="Adjust, lock, recompute, pay advance, or mark paid."
            >
              {!payout ? (
                <EmptyState
                  title={detailLoading ? "Loading…" : "Select a payout"}
                  description="Pick any row in the ledger to inspect, adjust, lock or pay."
                />
              ) : (
                <div className="stack">
                  {(error || detailError) ? (
                    <div className="error-text" role="alert" aria-live="polite">
                      {error || detailError}
                    </div>
                  ) : null}
                  {message ? (
                    <div className="success-text" role="status" aria-live="polite">
                      {message}
                    </div>
                  ) : null}
                  <div className="helper-box">
                    <div style={{ fontSize: 17, fontWeight: 600 }}>
                      {employeeNameForDetail || "—"}
                    </div>
                    <div style={{ marginTop: 2, color: "#64748b", fontSize: 12 }}>
                      Payout ref {payout.id}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <strong>Period:</strong> {payout.period_month} &nbsp;·&nbsp;
                      <strong>Status:</strong>{" "}
                      <span className={"status " + String(status).toLowerCase()}>
                        {status}
                      </span>
                    </div>
                    <div className="grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <strong>Gross:</strong> {formatCurrency(payout.gross_amount)}
                      </div>
                      <div>
                        <strong>Net:</strong> {formatCurrency(payout.net_amount)}
                      </div>
                      <div>
                        <strong>Duty count:</strong> {payout.duty_count || 0}
                      </div>
                      <div>
                        <strong>Hours:</strong> {payout.hours || 0}
                      </div>
                      <div>
                        <strong>Advance (adj):</strong> {formatCurrency(payout.advance)}
                      </div>
                      <div>
                        <strong>Deduction:</strong> {formatCurrency(payout.deduction)}
                      </div>
                      <div>
                        <strong>Bonus:</strong> {formatCurrency(payout.bonus)}
                      </div>
                      <div>
                        <strong>Paid so far:</strong> {formatCurrency(paidTotal)}
                      </div>
                      <div>
                        <strong>Outstanding:</strong>{" "}
                        <span className={outstanding > 0 ? "status open" : "status paid"}>
                          {formatCurrency(outstanding)}
                        </span>
                      </div>
                      <div>
                        <strong>Paid on:</strong> {payout.paid_at ? formatDate(payout.paid_at) : "-"}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: "1px dashed #cbd5e1",
                        fontSize: 12,
                        color: "#475569"
                      }}
                    >
                      <strong style={{ color: "#0f172a" }}>Accountability</strong>
                      <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                        <div>
                          Created by{" "}
                          <strong>{payout.created_by || "—"}</strong>
                          {payout.created_at
                            ? " · " + formatDate(payout.created_at)
                            : ""}
                        </div>
                        <div>
                          Last updated by{" "}
                          <strong>{payout.updated_by || payout.created_by || "—"}</strong>
                          {payout.updated_at
                            ? " · " + formatDate(payout.updated_at)
                            : ""}
                        </div>
                        {isPaid ? (
                          <div style={{ gridColumn: "1 / -1" }}>
                            Settled at{" "}
                            <strong>
                              {payout.paid_at ? formatDate(payout.paid_at) : "—"}
                            </strong>{" "}
                            by <strong>{payout.updated_by || "—"}</strong>
                          </div>
                        ) : null}
                      </div>
                      {auditTrail.length ? (
                        <details
                          style={{ marginTop: 8 }}
                          open={auditTrail.length <= 4}
                        >
                          <summary
                            style={{
                              cursor: "pointer",
                              fontWeight: 600,
                              color: "#0f172a"
                            }}
                          >
                            Full audit trail ({auditTrail.length}{" "}
                            entr{auditTrail.length === 1 ? "y" : "ies"})
                          </summary>
                          <table
                            style={{
                              width: "100%",
                              marginTop: 6,
                              fontSize: 11,
                              borderCollapse: "collapse"
                            }}
                          >
                            <thead>
                              <tr style={{ background: "#f1f5f9" }}>
                                <th style={{ textAlign: "left", padding: 4 }}>
                                  When
                                </th>
                                <th style={{ textAlign: "left", padding: 4 }}>
                                  Action
                                </th>
                                <th style={{ textAlign: "left", padding: 4 }}>
                                  Actor
                                </th>
                                <th style={{ textAlign: "left", padding: 4 }}>
                                  Notes
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditTrail.map(function (a) {
                                return (
                                  <tr key={a.id}>
                                    <td style={{ padding: 4 }}>
                                      {a.created_at ? formatDate(a.created_at) : "—"}
                                    </td>
                                    <td style={{ padding: 4 }}>
                                      {a.action || ""}
                                    </td>
                                    <td style={{ padding: 4 }}>
                                      {a.actor || "—"}
                                    </td>
                                    <td style={{ padding: 4, color: "#475569" }}>
                                      {a.stamp || ""}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </details>
                      ) : null}
                    </div>
                  </div>

                  {diagnostics ? (
                    <div
                      className="helper-box"
                      style={{
                        background: diagnostics.warning ? "#fff4f4" : "#f1f7ff",
                        borderColor: diagnostics.warning ? "#dc2626" : "#0c5adb"
                      }}
                    >
                      <div>
                        <strong>Where this data comes from</strong>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13 }}>
                        <div>
                          Gross ← <code>hh_payout_charges</code>: {diagnostics.charge_row_count} row
                          {diagnostics.charge_row_count === 1 ? "" : "s"} · sum {formatCurrency(diagnostics.charge_sum)}
                          {diagnostics.charge_zero_rate_rows > 0
                            ? " · " + diagnostics.charge_zero_rate_rows + " row(s) at ₹0"
                            : ""}
                          {diagnostics.charge_distinct_svc_keys > 0
                            ? " · " + diagnostics.charge_distinct_svc_keys + " billing service(s)"
                            : ""}
                        </div>
                        <div>
                          Duty count / Hours ← <code>hh_attendance</code>: {diagnostics.attendance_payable_count} payable row
                          {diagnostics.attendance_payable_count === 1 ? "" : "s"} · {diagnostics.attendance_payable_hours}h
                          {diagnostics.attendance_row_count > diagnostics.attendance_payable_count
                            ? " (" + (diagnostics.attendance_row_count - diagnostics.attendance_payable_count) + " non-payable)"
                            : ""}
                        </div>
                        <div>
                          Source duties ← <code>hh_duties</code>: {diagnostics.duty_row_count} row
                          {diagnostics.duty_row_count === 1 ? "" : "s"} overlapping {payout.period_month}
                          {Object.keys(diagnostics.duty_statuses || {}).length
                            ? " (" +
                              Object.entries(diagnostics.duty_statuses)
                                .map(function (pair) {
                                  return pair[0] + ": " + pair[1];
                                })
                                .join(", ") +
                              ")"
                            : ""}
                        </div>
                        {diagnostics.charge_last_updated_at ? (
                          <div style={{ color: "#64748b" }}>
                            Charges last materialized {formatDate(diagnostics.charge_last_updated_at)}
                          </div>
                        ) : null}
                      </div>
                      {diagnostics.warning ? (
                        <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 600 }}>
                          {diagnostics.warning}
                        </div>
                      ) : null}
                      {patientBreakdown.length ? (
                        <div className="stack" style={{ marginTop: 12 }}>
                          <strong>
                            Patients worked this period ({patientBreakdown.length})
                            {multiPatient ? " — multi-patient assignment" : ""}
                          </strong>
                          <div className="record-list" style={{ maxHeight: 220, overflowY: "auto" }}>
                            {patientBreakdown.map(function (pb) {
                              return (
                                <div key={pb.patient_id} className="record-card" style={{ padding: 10 }}>
                                  <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div>
                                      <h3 style={{ margin: 0 }}>{pb.patient_name || pb.patient_id}</h3>
                                      <div className="record-meta" style={{ marginTop: 4 }}>
                                        <span><strong>{pb.days_worked}</strong> day{pb.days_worked === 1 ? "" : "s"} present</span>
                                        <span>{pb.charged_days} charged</span>
                                        <span>{pb.hours}h</span>
                                        {pb.first_date && pb.last_date ? (
                                          <span>
                                            {pb.first_date} → {pb.last_date}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <strong>{formatCurrency(pb.amount)}</strong>
                                      <div className="mini-muted">
                                        {pb.duty_ids.length} dut{pb.duty_ids.length === 1 ? "y" : "ies"}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {canWrite && Array.isArray(diagnostics.duties_needing_rate) && diagnostics.duties_needing_rate.length > 0 ? (
                        <div className="stack" style={{ marginTop: 12 }}>
                          <strong>
                            Duties without a payout rate ({diagnostics.duties_needing_rate.length})
                          </strong>
                          <div className="record-list" style={{ maxHeight: 180, overflowY: "auto" }}>
                            {diagnostics.duties_needing_rate.map(function (d) {
                              return (
                                <div key={d.duty_id} className="record-card" style={{ padding: 8 }}>
                                  <div className="record-meta">
                                    <span>{d.duty_id}</span>
                                    <span>{d.service_name || ""}</span>
                                    <span>
                                      {istDayKey(d.start_at) || "—"} →{" "}
                                      {istDayKey(d.end_at) || "—"}
                                    </span>
                                    <span className={"status " + String(d.status || "").toLowerCase()}>
                                      {d.status}
                                    </span>
                                    {d.charge_per_day ? (
                                      <span>Charge ₹{d.charge_per_day}/day</span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <form
                            className="button-row"
                            onSubmit={handleSetRate}
                            style={{ alignItems: "flex-end" }}
                          >
                            <div className="field" style={{ minWidth: 180 }}>
                              <label>Payout per day for these duties</label>
                              <input
                                type="number"
                                min="1"
                                step="0.01"
                                placeholder="e.g. 800"
                                value={rateRepairRate}
                                onChange={function (event) {
                                  setRateRepairRate(event.target.value);
                                }}
                                disabled={busy || isPaid}
                              />
                            </div>
                            <button
                              type="submit"
                              className="button primary"
                              disabled={busy || isPaid || !rateRepairRate}
                            >
                              Set rate &amp; refresh
                            </button>
                          </form>
                          <div className="mini-muted">
                            Applies to <strong>{diagnostics.duties_needing_rate.length}</strong> duty/duties for{" "}
                            {employeeNameForDetail} in {payout.period_month}, then re-materializes the diary and
                            recomputes this payout.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {canDisburse && permissions.canPayFinal ? (
                    <div
                      className="helper-box"
                      style={{
                        background: "#eff6ff",
                        borderColor: "#0c5adb",
                        borderWidth: 2
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Next step ·{" "}
                        {status === "OPEN"
                          ? "Pay this payout"
                          : "Mark this payout paid"}
                      </div>
                      <div style={{ fontSize: 13, color: "#475569" }}>
                        {status === "OPEN"
                          ? "Choose either path below. Every payment requires an image proof (bank slip / UPI screenshot / signed receipt); the server rejects disbursements without one. Each accepted payment auto-generates a Receipt PDF with the proof embedded."
                          : "The payout is locked. Attach the payment-proof image and click 'Mark as paid' to record the final disbursement and generate the receipt PDF."}
                      </div>
                      <div className="button-row" style={{ marginTop: 8 }}>
                        {status === "OPEN" ? (
                          <button
                            type="button"
                            className="button primary"
                            onClick={function () {
                              setAdvanceOpen(true);
                              window.setTimeout(function () {
                                if (
                                  advanceFormRef.current &&
                                  typeof advanceFormRef.current.scrollIntoView === "function"
                                ) {
                                  advanceFormRef.current.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center"
                                  });
                                }
                              }, 80);
                            }}
                          >
                            Pay advance (partial) with proof
                          </button>
                        ) : null}
                        {status === "OPEN" && canWrite ? (
                          <div className="stack" style={{ width: "100%", marginTop: 6 }}>
                            <input
                              value={lockReason}
                              onChange={function (event) {
                                setLockReason(event.target.value);
                              }}
                              placeholder="Lock reason (required)"
                              aria-label="Reason for locking payout"
                            />
                            <button
                              type="button"
                              className="button primary"
                              onClick={handleLock}
                              disabled={busy || !String(lockReason || "").trim()}
                              title="Lock the period so the final Mark as paid form appears"
                            >
                              Lock → Mark as paid with proof
                            </button>
                          </div>
                        ) : null}
                        {status === "LOCKED" ? (
                          <button
                            type="button"
                            className="button primary"
                            onClick={function () {
                              if (
                                payFormRef.current &&
                                typeof payFormRef.current.scrollIntoView === "function"
                              ) {
                                payFormRef.current.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center"
                                });
                              }
                            }}
                          >
                            Attach proof & mark as paid
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {isPaid ? (
                    <div
                      className="helper-box"
                      style={{
                        background: "#ecfdf5",
                        borderColor: "#15803d",
                        borderWidth: 2
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        ✓ Settled — full payout disbursed.
                      </div>
                      <div style={{ fontSize: 13, color: "#15803d", marginTop: 4 }}>
                        Open any row in Disbursements below and click &lsquo;Receipt PDF&rsquo; to print or save the audit-grade receipt (image proof embedded).
                      </div>
                    </div>
                  ) : null}

                  <div className="button-row">
                    <button
                      className="button primary"
                      type="button"
                      onClick={printPayout}
                      title="Generate an audit-ready PDF of this payout (amounts, patients, disbursements, accountability trail)"
                    >
                      Print payout statement
                    </button>
                    {canWrite ? (
                      <button className="button secondary" type="button" onClick={handleRecompute} disabled={busy || !permissions.canAdjust}>
                        Recompute
                      </button>
                    ) : null}
                    {canWrite && permissions.canLock ? (
                      <div className="stack" style={{ flex: 1, minWidth: 220 }}>
                        <label className="mini-muted">Reason for locking (required)</label>
                        <input
                          value={lockReason}
                          onChange={function (event) {
                            setLockReason(event.target.value);
                          }}
                          placeholder="e.g. Verified duty days and net amount"
                        />
                        <button
                          className="button secondary"
                          type="button"
                          onClick={handleLock}
                          disabled={busy || !String(lockReason || "").trim()}
                        >
                          Lock for payment
                        </button>
                      </div>
                    ) : null}
                    {canReopen && permissions.canReopen ? (
                      <div className="stack" style={{ flex: 1, minWidth: 220 }}>
                        <label className="mini-muted">Reason for reopening (required)</label>
                        <input
                          value={reopenReason}
                          onChange={function (event) {
                            setReopenReason(event.target.value);
                          }}
                          placeholder="e.g. Correction needed before final pay"
                        />
                        <button
                          className="button secondary"
                          type="button"
                          onClick={handleReopen}
                          disabled={busy || !String(reopenReason || "").trim()}
                        >
                          Reopen payout
                        </button>
                      </div>
                    ) : null}
                    {canDisburse && permissions.canPayAdvance ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          setAdvanceOpen(function (v) {
                            return !v;
                          });
                        }}
                      >
                        {advanceOpen ? "Hide advance" : "Pay advance"}
                      </button>
                    ) : null}
                  </div>

                  {canDisburse && permissions.canAdjust ? (
                    <form className="stack" onSubmit={handleAdjust}>
                      <strong>Adjust</strong>
                      <div className="grid-2">
                        <div className="field">
                          <label>Advance</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.advance}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, advance: event.target.value });
                            }}
                            disabled={!permissions.canAdjust}
                          />
                        </div>
                        <div className="field">
                          <label>Deduction</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.deduction}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, deduction: event.target.value });
                            }}
                            disabled={!permissions.canAdjust}
                          />
                        </div>
                        <div className="field">
                          <label>Bonus</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.bonus}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, bonus: event.target.value });
                            }}
                            disabled={!permissions.canAdjust}
                          />
                        </div>
                        <div className="field">
                          <label>Remarks</label>
                          <input
                            value={adjustForm.remarks}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, remarks: event.target.value });
                            }}
                            disabled={!permissions.canAdjust}
                          />
                        </div>
                      </div>
                      <div className="button-row">
                        <button className="button primary" type="submit" disabled={busy || !permissions.canAdjust}>
                          Apply adjustment
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {canDisburse && advanceOpen && permissions.canPayAdvance ? (
                    <form className="stack" onSubmit={handleAdvance} ref={advanceFormRef}>
                      <strong>Pay advance</strong>
                      <div className="helper-box" style={{ background: "#fff7e6", borderColor: "#f59e0b" }}>
                        Payment proof (bank slip / UPI screenshot / signed receipt) is <strong>required</strong> before submission. The disbursement is rejected by the server if proof is missing.
                      </div>
                      <div className="grid-2">
                        <div className="field">
                          <label>Amount</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={advanceForm.amount}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, amount: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Paid on</label>
                          <input
                            type="date"
                            value={advanceForm.paid_on}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, paid_on: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Method</label>
                          <select
                            value={advanceForm.method}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, method: event.target.value });
                            }}
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
                          <label>Remarks</label>
                          <input
                            value={advanceForm.remarks}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, remarks: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field" style={{ gridColumn: "1 / -1" }}>
                          <label>Proof (image or PDF) — required</label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                            onChange={function (event) {
                              handleProofUpload("advance", event.target.files);
                            }}
                          />
                          <ProofPreview proof={advanceForm.proof} />
                        </div>
                      </div>
                      {confirmDisburse === "advance" ? (
                        <div
                          className="helper-box"
                          style={{ background: "#ecfdf5", borderColor: "#16a34a" }}
                        >
                          <strong>Confirm advance disbursement</strong>
                          <div style={{ marginTop: 4, fontSize: 13 }}>
                            {formatCurrency(advanceForm.amount)} on {advanceForm.paid_on} via{" "}
                            {advanceForm.method}. Proof attached.
                          </div>
                          <div className="button-row" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="button secondary"
                              onClick={function () {
                                setConfirmDisburse(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="button-row">
                        <button
                          className="button primary"
                          type="submit"
                          disabled={busy || !advanceForm.proof || !advanceForm.amount}
                        >
                          {confirmDisburse === "advance"
                            ? "Confirm and record advance"
                            : "Review and record advance"}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {canDisburse && permissions.canPayFinal ? (
                    <form className="stack" onSubmit={handlePay} ref={payFormRef}>
                      <strong>Mark as paid</strong>
                      <div className="helper-box" style={{ background: "#fff7e6", borderColor: "#f59e0b" }}>
                        Payment proof (bank slip / UPI screenshot / signed receipt) is <strong>required</strong> before submission. The disbursement is rejected by the server if proof is missing.
                      </div>
                      <div className="grid-2">
                        <div className="field">
                          <label>Paid on</label>
                          <input
                            type="date"
                            value={payForm.paid_on}
                            onChange={function (event) {
                              setPayForm({ ...payForm, paid_on: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Method</label>
                          <select
                            value={payForm.method}
                            onChange={function (event) {
                              setPayForm({ ...payForm, method: event.target.value });
                            }}
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
                          <label>Amount (blank = settle outstanding {formatCurrency(outstanding)})</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={payForm.amount}
                            placeholder={String(outstanding.toFixed(2))}
                            onChange={function (event) {
                              setPayForm({ ...payForm, amount: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>Remarks</label>
                          <input
                            value={payForm.remarks}
                            onChange={function (event) {
                              setPayForm({ ...payForm, remarks: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field" style={{ gridColumn: "1 / -1" }}>
                          <label>Proof (image or PDF) — required</label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                            onChange={function (event) {
                              handleProofUpload("pay", event.target.files);
                            }}
                          />
                          <ProofPreview proof={payForm.proof} />
                        </div>
                      </div>
                      {confirmDisburse === "pay" ? (
                        <div
                          className="helper-box"
                          style={{ background: "#ecfdf5", borderColor: "#16a34a" }}
                        >
                          <strong>Confirm final payment</strong>
                          <div style={{ marginTop: 4, fontSize: 13 }}>
                            Settle{" "}
                            {payForm.amount && Number(payForm.amount) > 0
                              ? formatCurrency(payForm.amount)
                              : formatCurrency(outstanding)}{" "}
                            on {payForm.paid_on} via {payForm.method}. Proof attached.
                          </div>
                          <div className="button-row" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="button secondary"
                              onClick={function () {
                                setConfirmDisburse(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="button-row">
                        <button className="button success" type="submit" disabled={busy || !payForm.proof}>
                          {confirmDisburse === "pay" ? "Confirm and mark paid" : "Review and mark paid"}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="stack">
                    <strong>Disbursements ({paidTransactions.length})</strong>
                    {paidTransactions.length === 0 ? (
                      <div className="helper-box">
                        No disbursements recorded yet. Use the{" "}
                        <strong>Next step</strong> panel above —{" "}
                        {status === "LOCKED"
                          ? "attach proof and click 'Mark as paid'"
                          : "either record an advance with proof, or lock and mark paid"}
                        . Every saved disbursement gets a unique serial, an
                        embedded proof image, and a downloadable Receipt PDF.
                      </div>
                    ) : (
                      <div className="record-list">
                        {paidTransactions.map(function (tx) {
                          var hasProof = !!(tx.proof_bucket && tx.proof_path);
                          return (
                            <div
                              key={tx.id}
                              className="record-card"
                              style={
                                hasProof
                                  ? undefined
                                  : { borderColor: "#dc2626", background: "#fff4f4" }
                              }
                            >
                              <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <h3>{tx.serial_no || tx.id}</h3>
                                  <div className="record-meta">
                                    <span>{tx.tx_kind || "FINAL"}</span>
                                    <span>{tx.paid_on || ""}</span>
                                    <span>{tx.method || ""}</span>
                                    <span>{formatCurrency(tx.amount)}</span>
                                    {hasProof ? (
                                      <span className="status paid">Proof ✓</span>
                                    ) : (
                                      <span className="status unpaid">
                                        Proof missing
                                      </span>
                                    )}
                                  </div>
                                  {tx.remarks ? <div className="record-meta"><span>{tx.remarks}</span></div> : null}
                                  <div
                                    className="mini-muted"
                                    style={{ marginTop: 4, fontSize: 11 }}
                                  >
                                    Recorded by{" "}
                                    <strong>{tx.created_by || "—"}</strong>
                                    {tx.created_at
                                      ? " on " + formatDate(tx.created_at)
                                      : ""}
                                    {tx.updated_by &&
                                    tx.updated_by !== tx.created_by
                                      ? " · last edited by " + tx.updated_by
                                      : ""}
                                  </div>
                                </div>
                                <div className="button-row">
                                  <button
                                    type="button"
                                    className="button secondary"
                                    onClick={function () {
                                      printReceipt(tx);
                                    }}
                                  >
                                    Receipt PDF
                                  </button>
                                  {hasProof ? (
                                    <button
                                      type="button"
                                      className="button secondary"
                                      onClick={function () {
                                        viewProof(tx);
                                      }}
                                    >
                                      View proof
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </ModuleShell>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense
      fallback={
        <AuthGuard permission="payouts.read">
          <AppShell title="Payouts">
            <div className="helper-box">Loading payouts…</div>
          </AppShell>
        </AuthGuard>
      }
    >
      <PayoutsPageContent />
    </Suspense>
  );
}
