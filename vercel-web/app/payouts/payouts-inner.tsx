"use client";

/**
 * Payout ledger UI (M9 Pass D). Date/form helpers: `@/lib/payoutUi`.
 * All writes via `/api/v1/payouts/*`.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { auditsClient, lookupsClient, payoutsClient } from "@/lib/clients";
import { paymentMethodOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow, preOpenPrintWindow, reportPrintBlocked } from "@/lib/print";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import { DUTY_LEDGER_READONLY_MESSAGE } from "@/lib/dutyLedgerUi";
import { isRealtimeEnabled } from "@/lib/realtimeConfig";
import {
  PAYOUT_PAY_ROLES,
  PAYOUT_REOPEN_ROLES,
  PAYOUT_WRITE_ROLES
} from "@/business/rbac";
import {
  PAYOUT_STATUS_OPTIONS,
  currentPeriod,
  detectPayoutDesync,
  emptyAdjustForm,
  emptyAdvanceForm,
  emptyEnsureForm,
  emptyPayForm,
  istDayKey
} from "@/lib/payoutUi";
import type { PayoutDetailDto } from "@/validation/payoutDto";
import {
  PAYOUTS_LIMIT,
  apiErrorMessage,
  isApiConflictError,
  payoutExpectedUpdatedAt,
  roleInList,
  emptyUnpaidEmployeesState,
  type AuditTrailRow,
  type EmployeeLookupRow,
  type PayoutAdjustForm,
  type PayoutAdvanceForm,
  type PayoutListEnvelope,
  type PayoutListRow,
  type PayoutPayForm,
  type PayoutProofAttachment,
  type PatientBreakdownRow,
  type PayoutDiagnostics,
  type PendingSummary,
  type UnpaidEmployeeRow,
  type UnpaidEmployeesState
} from "@/lib/payoutUi";


type PayoutsAuth = {
  session?: { access_token?: string } | null;
  profile?: { role?: string } | null;
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

type ConfirmDisburse = null | "pay" | "advance";

function PayoutsPageContent() {
  const auth = useAuth() as unknown as PayoutsAuth;
  const accessToken = auth.session?.access_token;
  const sessionRef = useRef(auth.session);
  sessionRef.current = auth.session;
  const supabaseRef = useRef(auth.supabase);
  supabaseRef.current = auth.supabase;
  const userRole = auth.profile?.role || "";
  const canWrite = roleInList(userRole, PAYOUT_WRITE_ROLES);
  const canDisburse = roleInList(userRole, PAYOUT_PAY_ROLES);
  const canReopen = roleInList(userRole, PAYOUT_REOPEN_ROLES);
  const showManualPayoutControls =
    process.env.NEXT_PUBLIC_ENABLE_PAYOUT_MANUAL_EDIT === "true";
  const searchParams = useSearchParams();
  const [employees, setEmployees] = useState<EmployeeLookupRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutListRow[]>([]);
  // P1-28: track API limit + server total for the "Showing first N of M" cap
  // banner. With a 200-row cap, busy practices used to silently lose payouts
  // 201+ from the ledger.
  
  const [payoutsTotal, setPayoutsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState(
    searchParams?.get("period") || currentPeriod()
  );
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState(
    searchParams?.get("employee_id") || ""
  );
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PayoutDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ensureForm, setEnsureForm] = useState(function () {
    const base = emptyEnsureForm();
    const ep = searchParams?.get("employee_id");
    const pm = searchParams?.get("period");
    if (ep) base.employee_id = ep;
    if (pm) base.period_month = pm;
    return base;
  });
  const [adjustForm, setAdjustForm] = useState<PayoutAdjustForm>(emptyAdjustForm());
  const [payForm, setPayForm] = useState<PayoutPayForm>(emptyPayForm());
  const [advanceForm, setAdvanceForm] = useState<PayoutAdvanceForm>(emptyAdvanceForm());
  // P1-29: every URL.createObjectURL() we mint for a proof preview must
  // eventually be released, otherwise the file's bytes stay in browser memory
  // until the tab closes. The ref accumulates created URLs and the unmount
  // cleanup + per-replace dispose calls revoke them.
  const proofObjectUrlsRef = useRef<string[]>([]);
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
  function disposeProofObjectUrl(proof: PayoutProofAttachment | null | undefined) {
    if (!proof || !proof.preview_url) return;
    try { URL.revokeObjectURL(proof.preview_url); } catch (_e) { /* noop */ }
    proofObjectUrlsRef.current = proofObjectUrlsRef.current.filter(function (u) {
      return u !== proof.preview_url;
    });
  }
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [rateRepairRate, setRateRepairRate] = useState("");
  const [pending, setPending] = useState<PendingSummary | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditTrailRow[]>([]);
  const [unpaidSearch, setUnpaidSearch] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  // Ref lets the "front-of-page" unpaid banner scroll the actual list
  // panel into view when the user clicks "Jump to list".
  const unpaidPanelRef = useRef<HTMLDivElement | null>(null);
  const [unpaidEmployees, setUnpaidEmployees] = useState<UnpaidEmployeesState>(emptyUnpaidEmployeesState());
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const [detailError, setDetailError] = useState("");
  const [message, setMessageState] = useState("");
  const toast = useToast();
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
  const [lockReason, setLockReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  /** null | "pay" | "advance" — second-step confirmation before disbursement */
  const [confirmDisburse, setConfirmDisburse] = useState<ConfirmDisburse>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [conflictPrompt, setConflictPrompt] = useState<{ message: string } | null>(null);
  // Refs let "Lock → Mark paid" and "Pay advance" actions auto-scroll the
  // proof uploader into view so the operator never has to hunt for it.
  const payFormRef = useRef<HTMLFormElement | null>(null);
  const advanceFormRef = useRef<HTMLFormElement | null>(null);
  // P1-2: openPayout request-token guard. Each click bumps the seq and the
  // in-flight request remembers its token; if a newer click landed by the
  // time the network resolves, every setDetail / setPayForm / setAdvanceForm
  // / setAdjustForm bails out so the user sees only the latest record.
  const openPayoutSeq = useRef(0);

  const reloadList = useCallback(async function () {
    const session = sessionRef.current;
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const data = (await payoutsClient.list(session, {
        limit: PAYOUTS_LIMIT,
        period: periodFilter || undefined,
        status: statusFilter || undefined,
        employee_id: employeeFilter || undefined
      })) as PayoutListEnvelope | PayoutListRow[];
      const prows = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      setPayouts(prows);
      setPayoutsTotal(
        Number(!Array.isArray(data) && data?.total != null ? data.total : prows.length) ||
          prows.length
      );
      setError("");
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Failed to load payouts");
      setPayouts([]);
      setPayoutsTotal(0);
    } finally {
      setLoading(false);
    }
  }, [periodFilter, statusFilter, employeeFilter, setError]);

  const reloadUnpaidEmployees = useCallback(async function () {
    const session = sessionRef.current;
    if (!session?.access_token || !periodFilter) {
      setUnpaidEmployees(emptyUnpaidEmployeesState());
      return;
    }
    setUnpaidEmployees(function (prev) {
      return { ...prev, loading: true, error: "" };
    });
    try {
      const data = await payoutsClient.pendingEmployees(session, { period: periodFilter });
      setUnpaidEmployees({
        period: data?.period || periodFilter,
        rows: (Array.isArray(data?.rows) ? data.rows : []).map(function (row) {
          return {
            ...row,
            payout_id: row.payout_id ?? undefined,
            payout_status: row.payout_status ?? undefined
          };
        }),
        total_pending: Number(data?.total_pending || 0),
        loading: false,
        source: data?.source || "rpc",
        error: ""
      });
    } catch (err: unknown) {
      setUnpaidEmployees({
        period: periodFilter,
        rows: [],
        total_pending: 0,
        loading: false,
        source: "rpc",
        error: (err instanceof Error ? err.message : String(err)) || "Could not load unpaid employees"
      });
    }
  }, [periodFilter]);

  const reloadPending = useCallback(async function () {
    const session = sessionRef.current;
    if (!session?.access_token || !employeeFilter || !periodFilter) {
      setPending(null);
      return;
    }
    try {
      const data = await payoutsClient.pending(session, {
        employee_id: employeeFilter,
        period: periodFilter
      });
      setPending((data as PendingSummary) || null);
    } catch (err: unknown) {
      setPending(null);
      setDetailError(
        (err instanceof Error ? err.message : String(err)) ||
          "Could not load pending totals from duty calendar"
      );
    }
  }, [employeeFilter, periodFilter]);

  const loadEmployees = useCallback(async function () {
    const session = sessionRef.current;
    if (!session?.access_token) return;
    try {
      const rows = await lookupsClient.employees(session);
      setEmployees(Array.isArray(rows) ? rows : []);
    } catch {
      setEmployees([]);
    }
  }, []);

  async function loadAuditTrail(payoutId: string) {
    if (!payoutId || !auth.session?.access_token) {
      setAuditTrail([]);
      return;
    }
    try {
      const data = await auditsClient.list(auth.session, {
        module: "payout",
        entity_id: payoutId,
        limit: 100
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      // Oldest first so the PDF reads as a chronological audit log.
      const sorted = rows
        .map(function (row) {
          return row as AuditTrailRow;
        })
        .sort(function (a: AuditTrailRow, b: AuditTrailRow) {
          const at = new Date(a.created_at || 0).getTime();
          const bt = new Date(b.created_at || 0).getTime();
          return at - bt;
        });
      setAuditTrail(sorted);
    } catch (err: unknown) {
      setAuditTrail([]);
      setDetailError((err instanceof Error ? err.message : String(err)) || "Could not load accountability audit trail");
    }
  }

  async function openPayout(id: string) {
    setDetailError("");
    if (!id) {
      setDetail(null);
      setSelectedId("");
      setAuditTrail([]);
      setExpectedUpdatedAt("");
      setConflictPrompt(null);
      return;
    }
    // P1-2: capture the request token BEFORE any await so a rapid second
    // click (or realtime-triggered re-open) cannot let the slower response
    // overwrite the latest row's detail/forms.
    openPayoutSeq.current += 1;
    const reqId = openPayoutSeq.current;
    setDetailLoading(true);
    setError("");
    setConflictPrompt(null);
    try {
      const data = (await payoutsClient.get(auth.session, id)) as PayoutDetailDto;
      if (reqId !== openPayoutSeq.current) return;
      setDetail(data);
      if (reqId !== openPayoutSeq.current) return;
      setSelectedId(id);
      loadAuditTrail(id);
      const row = data?.payout || {};
      if (reqId !== openPayoutSeq.current) return;
      const version = payoutExpectedUpdatedAt(data);
      setExpectedUpdatedAt(version);
      if (!version) {
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
      const disbursementCount = Array.isArray(data?.paid_transactions)
        ? data.paid_transactions.length
        : 0;
      const openOutstanding = Number(data?.outstanding || row.net_amount || 0);
      if (reqId !== openPayoutSeq.current) return;
      setAdvanceOpen(
        String(row.status || "OPEN") === "OPEN" &&
          disbursementCount === 0 &&
          openOutstanding > 0
      );
    } catch (err: unknown) {
      if (reqId !== openPayoutSeq.current) return;
      setError((err instanceof Error ? err.message : String(err)) || "Could not load payout detail");
      setDetail(null);
    } finally {
      if (reqId === openPayoutSeq.current) setDetailLoading(false);
    }
  }

  useEffect(
    function () {
      if (!accessToken) return;
      void reloadList();
      void reloadPending();
      void reloadUnpaidEmployees();
      void loadEmployees();
    },
    [
      accessToken,
      reloadList,
      reloadPending,
      reloadUnpaidEmployees,
      loadEmployees
    ]
  );

  useEffect(
    function () {
      const supabase = supabaseRef.current;
      if (!accessToken || !supabase || !isRealtimeEnabled()) return undefined;
      let timer: ReturnType<typeof setTimeout> | null = null;

      function scheduleRefresh() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          void reloadList();
          void reloadUnpaidEmployees();
          if (selectedId) {
            void openPayout(selectedId);
          } else {
            void reloadPending();
          }
        }, 300);
      }

      const channel = supabase.channel("crm-payout-ledger");
      [
        "hh_payouts",
        "hh_payout_charges",
        "hh_paid_transactions",
        "hh_duties",
        "hh_attendance"
      ].forEach(function (table) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: table },
          scheduleRefresh
        );
      });
      channel.subscribe();
      return function () {
        if (timer) clearTimeout(timer);
        supabase.removeChannel(channel);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, selectedId, reloadList, reloadUnpaidEmployees, reloadPending]
  );

  // Deep-link from duty calendar: if the URL carries ?employee_id=&period=
  // and a matching payout row already exists, auto-open it once the list
  // arrives so the user lands directly on the right record.
  useEffect(
    function () {
      const ep = searchParams?.get("employee_id");
      const pm = searchParams?.get("period");
      if (!ep || !pm) return;
      if (selectedId) return;
      const match = payouts.find(function (p) {
        return p.employee_id === ep && p.period_month === pm;
      });
      if (match) openPayout(match.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payouts, searchParams]
  );

  const totals = useMemo(
    function () {
      let net = 0;
      let paid = 0;
      let open = 0;
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
  const filteredUnpaid = useMemo(
    function () {
      const rows = Array.isArray(unpaidEmployees.rows) ? unpaidEmployees.rows : [];
      const term = String(unpaidSearch || "").trim().toLowerCase();
      if (!term) return rows;
      return rows.filter(function (r) {
        const name = String(r.employee_name || "").toLowerCase();
        const id = String(r.employee_id || "").toLowerCase();
        return name.indexOf(term) >= 0 || id.indexOf(term) >= 0;
      });
    },
    [unpaidEmployees.rows, unpaidSearch]
  );

  // Same search behaviour on the main payout ledger so operators can
  // narrow by employee name or payout ref without re-typing the ID into
  // the existing employee_id filter.
  const filteredPayouts = useMemo(
    function () {
      const term = String(ledgerSearch || "").trim().toLowerCase();
      if (!term) return payouts;
      return payouts.filter(function (p) {
        const name = String(p.employee_name || "").toLowerCase();
        const id = String(p.employee_id || "").toLowerCase();
        const ref = String(p.id || "").toLowerCase();
        return (
          name.indexOf(term) >= 0 ||
          id.indexOf(term) >= 0 ||
          ref.indexOf(term) >= 0
        );
      });
    },
    [payouts, ledgerSearch]
  );

  const filteredPaidPayouts = useMemo(
    function () {
      const term = String(unpaidSearch || "").trim().toLowerCase();
      return payouts
        .filter(function (p) {
          return String(p.status || "").toUpperCase() === "PAID";
        })
        .filter(function (p) {
          if (!term) return true;
          const name = String(p.employee_name || "").toLowerCase();
          const id = String(p.employee_id || "").toLowerCase();
          const ref = String(p.id || "").toLowerCase();
          return name.indexOf(term) >= 0 || id.indexOf(term) >= 0 || ref.indexOf(term) >= 0;
        });
    },
    [payouts, unpaidSearch]
  );

  function employeeDisplayName(id: string) {
    if (!id) return "";
    const emp = employees.find(function (e) {
      return e.id === id;
    });
    if (emp) return emp.full_name || emp.name || id;
    return id;
  }

  function payoutIdFromEnsureResult(data: unknown): string {
    if (!data || typeof data !== "object") return "";
    const root = data as Record<string, unknown>;
    if (root.id) return String(root.id);

    const payoutRow = root.payout;
    if (payoutRow && typeof payoutRow === "object") {
      const id = (payoutRow as Record<string, unknown>).id;
      if (id) return String(id);
    }

    const nested = root.data;
    if (nested && typeof nested === "object") {
      const nestedRow = nested as Record<string, unknown>;
      if (nestedRow.id) return String(nestedRow.id);
      const nestedPayout = nestedRow.payout;
      if (nestedPayout && typeof nestedPayout === "object") {
        const id = (nestedPayout as Record<string, unknown>).id;
        if (id) return String(id);
      }
    }

    return "";
  }

  async function loadPendingForEmployee(employeeId: string, period: string) {
    const session = sessionRef.current;
    if (!session?.access_token || !employeeId || !period) return null;
    const data = (await payoutsClient.pending(session, {
      employee_id: employeeId,
      period: period
    })) as PendingSummary;
    setPending(data || null);
    return data || null;
  }

  async function handleEnsure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    if (!ensureForm.employee_id) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await payoutsClient.ensure(auth.session, {
        employee_id: ensureForm.employee_id,
        period_month: ensureForm.period_month,
        advance: Number(ensureForm.advance || 0),
        deduction: Number(ensureForm.deduction || 0),
        bonus: Number(ensureForm.bonus || 0),
        remarks: ensureForm.remarks || ""
      });
      const ensuredName =
        data?.employee_name ||
        employeeDisplayName(ensureForm.employee_id) ||
        ensureForm.employee_id;
      setMessage("Payout ensured for " + ensuredName);
      setEnsureForm(emptyEnsureForm());
      await reloadList();
      await reloadUnpaidEmployees();
      if (data?.id) await openPayout(data.id);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not ensure payout");
    } finally {
      setBusy(false);
    }
  }

  function notePayoutConflict(err: unknown): boolean {
    if (!isApiConflictError(err)) return false;
    const text = apiErrorMessage(err, "Payout was modified by another user.");
    setConflictPrompt({ message: text });
    setError(text);
    return true;
  }

  async function reloadPayoutFromConflict() {
    if (!selectedId) {
      setConflictPrompt(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await openPayout(selectedId);
      setConflictPrompt(null);
      setMessage("Payout reloaded — your previous edits were discarded.");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not reload payout"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDisburse) return;
    if (!selectedId) return;
    setBusy(true);
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = {
        payout_id: selectedId,
        advance: Number(adjustForm.advance || 0),
        deduction: Number(adjustForm.deduction || 0),
        bonus: Number(adjustForm.bonus || 0),
        remarks: adjustForm.remarks || ""
      };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await payoutsClient.adjust(auth.session, payload);
      setMessage("Payout adjusted");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err: unknown) {
      if (!notePayoutConflict(err)) {
        setError(apiErrorMessage(err, "Could not adjust payout"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRate(event: FormEvent<HTMLFormElement>) {
    if (event && event.preventDefault) event.preventDefault();
    if (!canWrite) return;
    if (!payout) return;
    const rate = Number(rateRepairRate);
    if (!rate || rate <= 0) {
      setError("Enter a payout per day greater than 0");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await payoutsClient.setRate(auth.session, {
        employee_id: payout.employee_id,
        period: payout.period_month,
        payout_per_day: rate
      });
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
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not update duty rates");
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
      await payoutsClient.recompute(auth.session, selectedId);
      setMessage("Payout recomputed from duty + attendance");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not recompute");
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!canWrite) return;
    if (!selectedId) return;
    if (desyncDetected) {
      setError(
        "PAYOUT DESYNC DETECTED — RECOMPUTE REQUIRED before locking. Press Recompute to sync from the Duty Calendar."
      );
      return;
    }
    const reason = String(lockReason || "").trim();
    if (!reason) {
      setError("Enter a reason for locking this payout before payment");
      return;
    }
    setBusy(true);
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = { reason: reason };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await payoutsClient.lock(auth.session, selectedId, payload);
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
    } catch (err: unknown) {
      if (!notePayoutConflict(err)) {
        setError(apiErrorMessage(err, "Could not lock"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!canReopen) return;
    if (!selectedId) return;
    const reason = String(reopenReason || "").trim();
    if (!reason) {
      setError("Enter a reason for reopening this locked payout");
      return;
    }
    setBusy(true);
    setError("");
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = { reason: reason };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await payoutsClient.reopen(auth.session, selectedId, payload);
      setMessage("Payout reopened");
      await openPayout(selectedId);
      await reloadList();
    } catch (err: unknown) {
      if (!notePayoutConflict(err)) {
        setError(apiErrorMessage(err, "Could not reopen"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleProofUpload(target: "pay" | "advance", files: FileList | null) {
    if (!files || !files[0]) return;
    const file = files[0];
    setBusy(true);
    setError("");
    try {
      // P1-36: proof belongs to the employee being paid. payForm.employee_id
      // and advanceForm.employee_id are both required by the form so it
      // should always be present here; we fall back to a draft id for safety.
      const employeeId =
        target === "pay"
          ? payForm.employee_id
          : advanceForm.employee_id;
      const resourceId = employeeId || "draft-" + Math.random().toString(36).slice(2);
      const uploaded = await uploadDocument({
        bucket: "payout-proofs",
        file: file,
        session: auth.session,
        supabase: auth.supabase,
        resource: "Employees",
        resourceId: resourceId
      });
      // Cache an object URL so the preview tile renders the picture/PDF
      // immediately — no extra round-trip to Supabase storage required.
      let previewUrl = null;
      try {
        if (typeof window !== "undefined" && window.URL && file) {
          previewUrl = window.URL.createObjectURL(file);
          if (previewUrl) proofObjectUrlsRef.current.push(previewUrl);
        }
      } catch (_e) {
        previewUrl = null;
      }
      const enriched = {
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
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not upload proof");
    } finally {
      setBusy(false);
    }
  }

  // Visual preview tile for an attached payout proof. Renders an inline
  // <img> when the upload looks like an image, otherwise a PDF/file
  // confirmation card. The empty state explicitly demands a photo so
  // the accountant cannot miss the requirement.
  function ProofPreview(props: { proof?: PayoutProofAttachment | null }) {
    const proof = props && props.proof;
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
    const url = proof.preview_url || "";
    const name = proof.file_name || proof.path || "Attached";
    const lower = String(name).toLowerCase();
    const isImage =
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

  async function handlePay(event: FormEvent<HTMLFormElement>) {
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
    setConflictPrompt(null);
    try {
      const body: {
        payout_id: string;
        paid_on: string;
        method: string;
        remarks: string;
        proof_bucket?: string;
        proof_path?: string;
        photo: string;
        amount?: number;
        expected_updated_at?: string;
      } = {
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
      if (expectedUpdatedAt) body.expected_updated_at = expectedUpdatedAt;
      await payoutsClient.pay(auth.session, body);
      setMessage(
        "Payout marked PAID. Receipt PDF (with embedded payment-proof image) is ready in Disbursements below — click 'Receipt PDF' to print or save."
      );
      setPayForm(emptyPayForm());
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err: unknown) {
      if (!notePayoutConflict(err)) {
        setError(apiErrorMessage(err, "Could not mark paid"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance(event: FormEvent<HTMLFormElement>) {
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
    setConflictPrompt(null);
    try {
      const payload: Record<string, unknown> = {
        payout_id: selectedId,
        amount: Number(advanceForm.amount),
        paid_on: advanceForm.paid_on,
        method: advanceForm.method,
        remarks: advanceForm.remarks || "",
        proof_bucket: advanceForm.proof.bucket,
        proof_path: advanceForm.proof.path,
        photo: advanceForm.proof.file_name || ""
      };
      if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
      await payoutsClient.payAdvance(auth.session, selectedId, payload);
      setMessage(
        "Advance recorded. Receipt PDF (with embedded payment-proof image) is ready in Disbursements below — click 'Receipt PDF' to print or save."
      );
      setAdvanceForm(emptyAdvanceForm());
      setAdvanceOpen(false);
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err: unknown) {
      if (!notePayoutConflict(err)) {
        setError(apiErrorMessage(err, "Could not record advance"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function viewProof(tx: Record<string, unknown>) {
    if (!tx?.proof_bucket || !tx?.proof_path) return;
    try {
      const signed = await getDocumentSignedUrl(
        { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
        auth.session
      );
      if (signed?.signedUrl) {
        window.open(signed.signedUrl, "_blank", "noopener");
      } else {
        setError("Proof is not accessible");
      }
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || "Could not open proof");
    }
  }

  function escapeHtml(value: unknown) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function buildProofHtmlForTx(tx: Record<string, unknown>) {
    if (!tx?.proof_bucket || !tx?.proof_path) {
      return "<div class='meta' style='color:#b91c1c'><strong>No payment proof attached.</strong></div>";
    }
    try {
      const signed = await getDocumentSignedUrl(
        { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
        auth.session
      );
      const url = signed && signed.signedUrl;
      const lower = String(tx.photo || tx.proof_path || "").toLowerCase();
      const isImage = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(lower);
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
          "' target='_blank' rel='noopener noreferrer'>Open proof in new tab</a></div>"
        );
      }
      return (
        "<div class='meta'>Reference: " +
        escapeHtml(tx.photo || tx.proof_path) +
        " (signing failed)</div>"
      );
    } catch (err: unknown) {
      return (
        "<div class='meta'>Reference: " +
        escapeHtml(tx.photo || tx.proof_path) +
        " (" +
        escapeHtml((err instanceof Error ? err.message : String(err)) || "could not fetch signed URL") +
        ")</div>"
      );
    }
  }

  async function printPayout() {
    if (!detail?.payout) return;
    const preOpened = preOpenPrintWindow();
    if (!preOpened) {
      reportPrintBlocked(setError);
      return;
    }
    const row = detail.payout;
    const name = row.employee_name || employeeDisplayName(String(row.employee_id || ""));
    const paidRows = Array.isArray(detail.paid_transactions)
      ? detail.paid_transactions
      : [];
    const paidTable = paidRows.length
      ? "<table><thead><tr><th>Serial</th><th>Kind</th><th>Date</th><th>Method</th><th>Amount</th><th>Proof</th><th>Recorded by</th></tr></thead><tbody>" +
        paidRows
          .map(function (t) {
            const hasProof = !!(t.proof_bucket && t.proof_path);
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

    const pb = Array.isArray(detail.patient_breakdown)
      ? detail.patient_breakdown
      : [];
    const patientTable = pb.length
      ? "<table><thead><tr><th>#</th><th>Patient</th><th>Duty days</th><th>Hours</th><th>Window</th><th>Amount</th></tr></thead><tbody>" +
        pb
          .map(function (p, idx) {
            return (
              "<tr><td>" +
              (idx + 1) +
              "</td><td>" +
              escapeHtml(p.patient_name || p.patient_id) +
              "</td><td>" +
              (p.charged_days || p.days_worked || 0) +
              "</td><td>" +
              (p.hours || 0) +
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
    const dutyRows = Array.isArray(detail.duties) ? detail.duties : [];
    const patientNameById: Record<string, string> = {};
    pb.forEach(function (p) {
      if (p && p.patient_id) {
        patientNameById[String(p.patient_id)] = String(p.patient_name || p.patient_id);
      }
    });
    function shortDate(value: unknown) {
      if (!value) return "—";
      try {
        const s = String(value);
        if (s.length >= 10) return s.slice(0, 10);
        return s;
      } catch (_e) {
        return String(value || "—");
      }
    }
    const workLogTable = dutyRows.length
      ? "<table><thead><tr><th>#</th><th>Duty ID</th><th>Patient</th><th>Service</th><th>Shift</th><th>From</th><th>To</th><th>Status</th><th>Charge/day</th><th>Payout/day</th></tr></thead><tbody>" +
        dutyRows
          .map(function (d, idx) {
            const pid = String(d.patient_id || "");
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

    const auditHeader =
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
    const trail = Array.isArray(auditTrail) ? auditTrail : [];
    const auditRowsHtml = trail.length
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
    const auditTable =
      "<h3>Accountability — audit trail</h3>" +
      "<table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Notes</th></tr></thead><tbody>" +
      auditRowsHtml +
      "</tbody></table>";

    let body =
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

    let proofBundle = "";
    for (let pi = 0; pi < paidRows.length; pi += 1) {
      const ptx = paidRows[pi];
      if (!ptx) continue;
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
    openPrintWindow("Payout " + row.id, body, preOpened);
  }

  // One-receipt-per-transaction PDF. Includes serial, employee name, payout
  // ref, method, amount, remarks, the per-patient breakdown for the period
  // (so the receipt explains "this ₹X is for N days across M patients"),
  // and the payment proof embedded as an image when the proof is an image
  // file. PDF proofs are linked instead of embedded — print engines vary
  // wildly on cross-doc embedding.
  async function printReceipt(tx: Record<string, unknown>) {
    if (!tx) return;
    const preOpened = preOpenPrintWindow();
    if (!preOpened) {
      reportPrintBlocked(setError);
      return;
    }
    const row = detail?.payout || null;
    const name = row
      ? row.employee_name || employeeDisplayName(String(row.employee_id || ""))
      : employeeDisplayName(String(tx.employee_id || ""));
    const period = row?.period_month || tx.period_month || "";
    const kindLabel = String(tx.tx_kind || "FINAL") === "ADVANCE" ? "Advance Receipt" : "Payout Receipt";

    const rows: [string, unknown][] = [
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
          (tx.created_at ? " on " + formatDate(String(tx.created_at)) : "")
      ]
    ];
    if (tx.updated_by && tx.updated_by !== tx.created_by) {
      rows.push(["Last edited by", tx.updated_by]);
    }
    const rowsHtml = rows
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
    const pbAll = Array.isArray(detail?.patient_breakdown)
      ? detail.patient_breakdown
      : [];
    const pb = pbAll.filter(function (p) {
      return Number(p.days_worked || 0) > 0 || Number(p.amount || 0) > 0;
    });
    const patientTable = pb.length
      ? "<h3>Days worked this period (" + pb.length + " patient" + (pb.length === 1 ? "" : "s") + ")</h3>" +
        "<table><thead><tr><th>#</th><th>Patient</th><th>Duty days</th><th>Hours</th><th>Window</th><th>Amount</th></tr></thead><tbody>" +
        pb
          .map(function (p, idx) {
            return (
              "<tr><td>" +
              (idx + 1) +
              "</td><td>" +
              escapeHtml(p.patient_name || p.patient_id) +
              "</td><td>" +
              (p.charged_days || p.days_worked || 0) +
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
    let proofHtml = "";
    if (tx.proof_bucket && tx.proof_path) {
      try {
        const signed = await getDocumentSignedUrl(
          { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
          auth.session
        );
        const url = signed && signed.signedUrl;
        const lower = String(tx.photo || tx.proof_path || "").toLowerCase();
        const isImage = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(lower);
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
            "<div class='meta'><a href='" + url + "' target='_blank' rel='noopener noreferrer'>Open proof in new tab</a></div>";
        } else {
          proofHtml =
            "<h3>Payment proof</h3>" +
            "<div class='meta'>Reference: " + escapeHtml(tx.photo || tx.proof_path) + " (signing failed — open from the disbursement row).</div>";
        }
      } catch (err: unknown) {
        proofHtml =
          "<h3>Payment proof</h3>" +
          "<div class='meta'>Reference: " + escapeHtml(tx.photo || tx.proof_path) + " (" + escapeHtml((err instanceof Error ? err.message : String(err)) || "could not fetch signed URL") + ")</div>";
      }
    } else {
      proofHtml = "<div class='meta' style='color:#b91c1c'><strong>No payment proof was attached.</strong></div>";
    }

    const body =
      "<h2>" + kindLabel + "</h2>" +
      "<table><tbody>" + rowsHtml + "</tbody></table>" +
      patientTable +
      proofHtml +
      "<div class='stamp'>I confirm I have received the above amount from Hominal Healthcare Pvt Ltd.</div>";

    openPrintWindow(kindLabel + " " + (tx.serial_no || tx.id || ""), body, preOpened);
  }

  async function selectUnpaidEmployee(row: UnpaidEmployeeRow) {
    if (!row || !row.employee_id) return;
    if (busy || detailLoading) return;
    const employeeId = String(row.employee_id);
    const period = unpaidEmployees.period || periodFilter || currentPeriod();
    setEmployeeFilter(employeeId);
    setEnsureForm(function (prev) {
      return {
        ...prev,
        employee_id: employeeId,
        period_month: period
      };
    });
    setError("");
    setDetailError("");
    setMessage("Opening payout for " + (row.employee_name || employeeDisplayName(employeeId)));

    let pendingData: PendingSummary | null = null;
    try {
      pendingData = await loadPendingForEmployee(employeeId, period);
    } catch (err: unknown) {
      setDetailError(apiErrorMessage(err, "Could not load this employee's payout summary"));
    }

    const pendingPayoutId = String(pendingData?.payout?.id || "");
    const existingPayoutId = String(row.payout_id || pendingPayoutId || "");
    if (existingPayoutId) {
      await openPayout(existingPayoutId);
      return;
    }

    if (!canWrite) {
      setError("This employee does not have a payout row yet. Ask Admin, Manager, or Accountant to ensure it.");
      return;
    }

    setBusy(true);
    try {
      const data = await payoutsClient.ensure(auth.session, {
        employee_id: employeeId,
        period_month: period,
        advance: 0,
        deduction: 0,
        bonus: 0,
        remarks: "Created from unpaid employee list"
      });
      let ensuredPayoutId = payoutIdFromEnsureResult(data);
      let ensuredName = row.employee_name || employeeDisplayName(employeeId);
      if (!ensuredPayoutId) {
        const refreshedPending = await loadPendingForEmployee(employeeId, period);
        ensuredPayoutId = String(refreshedPending?.payout?.id || "");
      }
      if (data && typeof data === "object") {
        const employeeName = (data as Record<string, unknown>).employee_name;
        if (employeeName) ensuredName = String(employeeName);
      }
      await reloadList();
      await reloadUnpaidEmployees();
      if (ensuredPayoutId) {
        await openPayout(ensuredPayoutId);
        setMessage("Payout opened for " + ensuredName);
      } else {
        setError("Payout was ensured, but the server did not return a payout id. Click Refresh and select this employee again.");
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not open or ensure this employee payout"));
    } finally {
      setBusy(false);
    }
  }

  const payout = detail?.payout || null;
  const status = String(payout?.status || "OPEN");
  const permissions = detail?.permissions || {
    canAdjust: false,
    canLock: false,
    canReopen: false,
    canPayFinal: false,
    canPayAdvance: false
  };
  const isPaid = status === "PAID";
  const paidTransactions: Record<string, unknown>[] = Array.isArray(detail?.paid_transactions)
    ? (detail.paid_transactions as Record<string, unknown>[])
    : [];
  const pendingMatchesDetail =
    !!pending &&
    !!payout &&
    String(pending.employee_id || "") === String(payout.employee_id || "") &&
    String(pending.period || "") === String(payout.period_month || "");
  const displayedGross = pendingMatchesDetail
    ? Number(pending?.charged || 0)
    : Number(payout?.gross_amount || 0);
  const displayedDutyCount = pendingMatchesDetail
    ? Number(pending?.duty_count || 0)
    : Number(payout?.duty_count || 0);
  const displayedHours = pendingMatchesDetail
    ? Number(pending?.hours || payout?.hours || 0)
    : Number(payout?.hours || 0);
  const displayedNet = Math.max(
    0,
    displayedGross
  );
  const displayedPaidTotal = pendingMatchesDetail
    ? Number(pending?.paid || 0)
    : Number(detail?.paid_total || 0);
  const displayedOutstanding = pendingMatchesDetail
    ? Number(pending?.pending || 0)
    : Number(detail?.outstanding || 0);
  const outstanding = displayedOutstanding;
  const paidTotal = displayedPaidTotal;
  const employeeNameForDetail = payout
    ? payout.employee_name || employeeDisplayName(String(payout.employee_id || ""))
    : "";
  const diagnostics = (detail?.diagnostics as PayoutDiagnostics | null) || null;
  const patientBreakdown: PatientBreakdownRow[] = Array.isArray(detail?.patient_breakdown)
    ? (detail.patient_breakdown as PatientBreakdownRow[])
    : [];
  const multiPatient = patientBreakdown.length > 1;

  const cachedGross = Number(payout?.gross_amount || 0);
  const cachedDutyCount = Number(payout?.duty_count || 0);
  const liveGross = pendingMatchesDetail ? Number(pending?.charged || 0) : cachedGross;
  const liveDutyCount = pendingMatchesDetail
    ? Number(pending?.duty_count || 0)
    : cachedDutyCount;
  const chargeRowCount = Number(diagnostics?.charge_row_count ?? liveDutyCount);
  const desyncDetected = detectPayoutDesync({
    liveGross,
    liveDutyCount,
    cachedGross,
    cachedDutyCount,
    status,
    comparable: pendingMatchesDetail
  });

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
            {canWrite && showManualPayoutControls ? (
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
                        const v = event.target.value;
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
              <ModuleShell title="Monthly payout source" description="Payout is read from duty calendar only. Manual amount editing is disabled.">
                <div className="helper-box">
                  Select the period, search the unpaid list, open an employee, then use
                  <strong> Recompute</strong> if required. Amounts are calculated only from duty calendar
                  rows and saved disbursements.
                </div>
                <div className="grid-2" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Period</label>
                    <input
                      type="month"
                      value={periodFilter}
                      onChange={function (event) {
                        const v = event.target.value;
                        if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return;
                        setPeriodFilter(v);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Search employee</label>
                    <input
                      type="search"
                      value={unpaidSearch}
                      onChange={function (event) {
                        setUnpaidSearch(event.target.value);
                      }}
                      placeholder="Name or employee ID"
                    />
                  </div>
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
                    <span
                      className={
                        Number(pending.pending || 0) > 0 ? "status open" : "status paid"
                      }
                    >
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
                      {pending.paid_transactions.map(function (tx: Record<string, unknown>) {
                        return (
                          <div key={String(tx.id || tx.serial_no)} className="record-card">
                            <div className="record-meta">
                              <span>{String(tx.serial_no || tx.id || "")}</span>
                              <span>{String(tx.tx_kind || "FINAL")}</span>
                              <span>{String(tx.paid_on || "")}</span>
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
                    const statusLabel = row.payout_status || "UNPAID";
                    return (
                      <div
                        key={row.employee_id}
                        className="record-card"
                        role="button"
                        tabIndex={0}
                        title="Open or create this employee payout"
                        onClick={function () {
                          void selectUnpaidEmployee(row);
                        }}
                        onKeyDown={function (event) {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void selectUnpaidEmployee(row);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>
                              {row.employee_name &&
                              row.employee_name !== row.employee_id
                                ? row.employee_name
                                : employeeDisplayName(String(row.employee_id || "")) ||
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
                                disabled={busy || detailLoading}
                                onClick={function (event) {
                                  event.stopPropagation();
                                  void selectUnpaidEmployee(row);
                                }}
                              >
                                {detailLoading ? "Opening…" : "Open"}
                              </button>
                            ) : canWrite ? (
                              <button
                                type="button"
                                className="button primary"
                                disabled={busy || detailLoading}
                                onClick={function (event) {
                                  event.stopPropagation();
                                  void selectUnpaidEmployee(row);
                                }}
                              >
                                {busy ? "Opening…" : "Ensure & open"}
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

            <ModuleShell
              title={"Paid employees — " + (periodFilter || "")}
              description="Settled monthly payouts are shown here after payment is recorded."
            >
              {!filteredPaidPayouts.length ? (
                <div className="helper-box">No paid employees found for this period.</div>
              ) : (
                <div className="record-list">
                  {filteredPaidPayouts.map(function (row) {
                    const name = row.employee_name || employeeDisplayName(String(row.employee_id || ""));
                    return (
                      <div
                        key={row.id}
                        className="record-card"
                        role="button"
                        tabIndex={0}
                        onClick={function () {
                          openPayout(row.id);
                        }}
                        onKeyDown={function (event) {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPayout(row.id);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between" }}>
                          <div>
                            <h3>{name || row.employee_id || "Employee"}</h3>
                            <div className="record-meta">
                              <span>{row.period_month}</span>
                              <span>{row.duty_count || 0} duties</span>
                              <span>Paid {formatCurrency(row.net_amount)}</span>
                            </div>
                          </div>
                          <span className="status paid">PAID</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>

            <ModuleShell title="Payout ledger" description="hh_payouts month view. Filter by period, status, or employee.">
              <div className="toolbar">
                <div className="field">
                  <label>Period</label>
                  <input
                    type="month"
                    value={periodFilter}
                    onChange={function (event) {
                      const v = event.target.value;
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
              <ErrorBanner message={error} />
              <SuccessBanner message={message} />
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
                    const name = row.employee_name || employeeDisplayName(String(row.employee_id || ""));
                    const isSelected = selectedId === row.id;
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
              description="Duty-calendar payout detail. Amounts are read-only; recompute refreshes from duties."
            >
              {!payout ? (
                <div className="stack">
                  {(error || detailError) ? (
                    <div className="error-text" role="alert" aria-live="polite">
                      {error || detailError}
                    </div>
                  ) : null}
                  {message ? <SuccessBanner message={message} /> : null}
                  <EmptyState
                    title={
                      detailLoading
                        ? "Loading…"
                        : pending
                          ? "Pending payout loaded"
                          : "Select a payout"
                    }
                    description={
                      pending
                        ? "Pending duty-calendar totals are loaded. If the detail does not open, use Ensure payout to create the ledger row."
                        : "Pick any row in the ledger or unpaid employee list to inspect, adjust, lock or pay."
                    }
                  />
                </div>
              ) : (
                <div className="stack">
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
                          onClick={reloadPayoutFromConflict}
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
                  {(error || detailError) && !conflictPrompt ? (
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
                    <div
                      className="helper-box"
                      style={{ marginTop: 10, background: "#f8fafc", borderColor: "#cbd5e1" }}
                    >
                      {DUTY_LEDGER_READONLY_MESSAGE}{" "}
                      <a href="/duties" style={{ fontWeight: 600 }}>
                        Open Duty Calendar →
                      </a>
                    </div>
                    {desyncDetected ? (
                      <div
                        role="alert"
                        style={{
                          marginTop: 10,
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "#fef2f2",
                          border: "2px solid #dc2626",
                          color: "#991b1b",
                          fontSize: 13,
                          fontWeight: 600
                        }}
                      >
                        PAYOUT DESYNC DETECTED — RECOMPUTE REQUIRED
                        <div style={{ fontWeight: 400, marginTop: 4 }}>
                          Cached payout ({formatCurrency(cachedGross)} · {cachedDutyCount} duties)
                          does not match the live duty calendar ({formatCurrency(liveGross)} ·{" "}
                          {liveDutyCount} duties). Payment locking is blocked until you press{" "}
                          <strong>Recompute</strong>.
                        </div>
                      </div>
                    ) : null}
                    <div className="grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <strong>Gross:</strong> {formatCurrency(displayedGross)}
                      </div>
                      <div>
                        <strong>Net:</strong> {formatCurrency(displayedNet)}
                      </div>
                      <div>
                        <strong>Duty count:</strong> {displayedDutyCount}
                      </div>
                      <div>
                        <strong>Hours:</strong> {displayedHours}
                      </div>
                      {showManualPayoutControls ? (
                        <>
                          <div>
                            <strong>Advance (adj):</strong> {formatCurrency(payout.advance)}
                          </div>
                          <div>
                            <strong>Deduction:</strong> {formatCurrency(payout.deduction)}
                          </div>
                          <div>
                            <strong>Bonus:</strong> {formatCurrency(payout.bonus)}
                          </div>
                        </>
                      ) : null}
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
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: desyncDetected ? "#fef2f2" : "#f0fdf4",
                        border: "1px solid " + (desyncDetected ? "#fecaca" : "#bbf7d0"),
                        fontSize: 12,
                        color: "#334155"
                      }}
                    >
                      <strong style={{ color: "#0f172a" }}>
                        Reconciliation · duty calendar = source of truth
                      </strong>
                      <div
                        style={{
                          marginTop: 6,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "4px 16px"
                        }}
                      >
                        <span>Duty calendar rows (live)</span>
                        <strong>{liveDutyCount}</strong>
                        <span>Gross payout (live)</span>
                        <strong>{formatCurrency(liveGross)}</strong>
                        <span>Cached aggregate</span>
                        <strong style={{ color: desyncDetected ? "#dc2626" : "#15803d" }}>
                          {formatCurrency(cachedGross)} · {cachedDutyCount} duties
                          {desyncDetected ? " (stale)" : " (in sync)"}
                        </strong>
                        <span>Paid amount</span>
                        <strong>{formatCurrency(paidTotal)}</strong>
                        <span>Outstanding</span>
                        <strong>{formatCurrency(outstanding)}</strong>
                        <span>Source ledger</span>
                        <strong>
                          <code>hh_payout_charges</code> · {chargeRowCount} row
                          {chargeRowCount === 1 ? "" : "s"}
                        </strong>
                        <span>Last recomputed</span>
                        <strong>
                          {payout.updated_at ? formatDate(String(payout.updated_at)) : "—"}
                        </strong>
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
                          <strong>{String(payout.created_by || "—")}</strong>
                          {payout.created_at
                            ? " · " + formatDate(String(payout.created_at))
                            : ""}
                        </div>
                        <div>
                          Last updated by{" "}
                          <strong>
                            {String(payout.updated_by || payout.created_by || "—")}
                          </strong>
                          {payout.updated_at
                            ? " · " + formatDate(String(payout.updated_at))
                            : ""}
                        </div>
                        {isPaid ? (
                          <div style={{ gridColumn: "1 / -1" }}>
                            Settled at{" "}
                            <strong>
                              {payout.paid_at ? formatDate(String(payout.paid_at)) : "—"}
                            </strong>{" "}
                            by <strong>{String(payout.updated_by || "—")}</strong>
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
                          Duty-calendar payout rows ← <code>hh_payout_charges</code>: {diagnostics.charge_row_count} row
                          {diagnostics.charge_row_count === 1 ? "" : "s"} · sum {formatCurrency(diagnostics.charge_sum)}
                          {(diagnostics.charge_zero_rate_rows || 0) > 0
                            ? " · " + diagnostics.charge_zero_rate_rows + " row(s) at ₹0"
                            : ""}
                          {(diagnostics.charge_distinct_svc_keys || 0) > 0
                            ? " · " + diagnostics.charge_distinct_svc_keys + " billing service(s)"
                            : ""}
                        </div>
                        <div>
                          Source duties ← <code>hh_duties</code>: {diagnostics.duty_row_count} row
                          {diagnostics.duty_row_count === 1 ? "" : "s"} overlapping {payout.period_month}
                          {Object.keys(diagnostics.duty_statuses || {}).length
                            ? " (" +
                              Object.entries(diagnostics.duty_statuses || {})
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
                                        <span><strong>{pb.charged_days || pb.days_worked || 0}</strong> duty day{(pb.charged_days || pb.days_worked || 0) === 1 ? "" : "s"}</span>
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
                                        {(pb.duty_ids || []).length} dut
                                        {(pb.duty_ids || []).length === 1 ? "y" : "ies"}
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
                            {diagnostics.duties_needing_rate.map(function (d: Record<string, unknown>) {
                              return (
                                <div
                                  key={String(d.duty_id || d.id || Math.random())}
                                  className="record-card"
                                  style={{ padding: 8 }}
                                >
                                  <div className="record-meta">
                                    <span>{String(d.duty_id || "")}</span>
                                    <span>{String(d.service_name || "")}</span>
                                    <span>
                                      {istDayKey(String(d.start_at || "")) || "—"} →{" "}
                                      {istDayKey(String(d.end_at || "")) || "—"}
                                    </span>
                                    <span className={"status " + String(d.status || "").toLowerCase()}>
                                      {String(d.status || "")}
                                    </span>
                                    {d.charge_per_day ? (
                                      <span>Charge ₹{String(d.charge_per_day)}/day</span>
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
                          ? "Lock the verified month, then attach payment proof and mark paid. Every payment requires an image proof (bank slip / UPI screenshot / signed receipt)."
                          : "The payout is locked. Attach the payment-proof image and click 'Mark as paid' to record the final disbursement and generate the receipt PDF."}
                      </div>
                      <div className="button-row" style={{ marginTop: 8 }}>
                        {status === "OPEN" && permissions.canPayAdvance ? (
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
                            Add payment receipt
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
                              disabled={busy || desyncDetected || !String(lockReason || "").trim()}
                              title={
                                desyncDetected
                                  ? "Payout is out of sync with the duty calendar — Recompute before locking"
                                  : "Lock the period so the final Mark as paid form appears"
                              }
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
                          disabled={busy || desyncDetected || !String(lockReason || "").trim()}
                          title={
                            desyncDetected
                              ? "Payout is out of sync with the duty calendar — Recompute before locking"
                              : undefined
                          }
                        >
                          Lock for payment
                        </button>
                      </div>
                    ) : null}
                    {showManualPayoutControls && canReopen && permissions.canReopen ? (
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
                        {advanceOpen ? "Hide receipt entry" : "Add payment receipt"}
                      </button>
                    ) : null}
                  </div>

                  {showManualPayoutControls && canDisburse && permissions.canAdjust ? (
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
                      <strong>Payment receipt entry</strong>
                      <div className="helper-box" style={{ background: "#fff7e6", borderColor: "#f59e0b" }}>
                        Record a partial or advance payment against this payout. Duty amount is still read-only from the duty calendar. Payment proof (bank slip / UPI screenshot / signed receipt) is <strong>required</strong> before submission.
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
                          const hasProof = !!(tx.proof_bucket && tx.proof_path);
                          return (
                            <div
                              key={String(tx.id || tx.serial_no || Math.random())}
                              className="record-card"
                              style={
                                hasProof
                                  ? undefined
                                  : { borderColor: "#dc2626", background: "#fff4f4" }
                              }
                            >
                              <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <h3>{String(tx.serial_no || tx.id || "")}</h3>
                                  <div className="record-meta">
                                    <span>{String(tx.tx_kind || "FINAL")}</span>
                                    <span>{String(tx.paid_on || "")}</span>
                                    <span>{String(tx.method || "")}</span>
                                    <span>{formatCurrency(tx.amount)}</span>
                                    {hasProof ? (
                                      <span className="status paid">Proof ✓</span>
                                    ) : (
                                      <span className="status unpaid">
                                        Proof missing
                                      </span>
                                    )}
                                  </div>
                                  {tx.remarks ? (
                                    <div className="record-meta">
                                      <span>{String(tx.remarks)}</span>
                                    </div>
                                  ) : null}
                                  <div
                                    className="mini-muted"
                                    style={{ marginTop: 4, fontSize: 11 }}
                                  >
                                    Recorded by{" "}
                                    <strong>{String(tx.created_by || "—")}</strong>
                                    {tx.created_at
                                      ? " on " + formatDate(String(tx.created_at))
                                      : ""}
                                    {tx.updated_by &&
                                    tx.updated_by !== tx.created_by
                                      ? " · last edited by " + String(tx.updated_by)
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
            <div className="helper-box" role="status" aria-live="polite">
              Loading payouts…
            </div>
          </AppShell>
        </AuthGuard>
      }
    >
      <PayoutsPageContent />
    </Suspense>
  );
}
