"use client";

/**
 * Duty calendar & per-day diary (M7 Pass D).
 * Calendar date helpers: `@/lib/dutyUi`. All writes via `/api/v1/duties/*`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useBusyGuard } from "@/hooks/use-busy-guard";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { useAuth } from "@/components/providers/auth-provider";
import { billingsClient, dutiesClient, lookupsClient } from "@/lib/clients";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { crmDayStartIso, crmDayEndIso } from "@/src/utils/crmToday";
import {
  DUTY_STATUSES,
  daysInMonthGrid,
  dutyTouchesDay,
  isOpenEndedIso,
  istDayKey,
  monthKey,
  partnerDisplayName,
  type DutyDiaryEntry,
  type DutyListRow
} from "@/lib/dutyUi";
import type { DutyPermissionsDto } from "@/validation/dutyDto";
import type { Role } from "@/business/rbac";
import {
  DUTY_CANCEL_ROLES,
  DUTY_CHECK_IN_ROLES,
  DUTY_DELETE_ROLES,
  DUTY_DIARY_WRITE_ROLES,
  DUTY_MATERIALIZE_ROLES,
  DUTY_WRITE_ROLES
} from "@/business/rbac";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DutiesAuth = {
  session?: { access_token?: string } | null;
  profile?: { role?: string } | null;
  supabase?: {
    channel: (name: string) => {
      on: (event: string, filter: object, handler: () => void) => { on: (...args: unknown[]) => unknown };
      subscribe: () => void;
    };
    removeChannel: (channel: unknown) => void;
  };
};

interface LookupRow {
  id: string;
  name?: string;
  full_name?: string;
}

interface ServiceOption {
  id?: string;
  name?: string;
  service_name?: string;
  label?: string;
}

interface DutyFormExtraPartner {
  row_id: string;
  employee_id: string;
  charge_per_day: string;
  payout_per_day: string;
  payout_term: string;
}

function newExtraPartnerRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "partner-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 9);
}

function emptyExtraPartner(): DutyFormExtraPartner {
  return {
    row_id: newExtraPartnerRowId(),
    employee_id: "",
    charge_per_day: "",
    payout_per_day: "",
    payout_term: "Daily"
  };
}

interface DutyFormState {
  id: string;
  patient_id: string;
  employee_id: string;
  service_name: string;
  shift_type: string;
  start_at: string;
  end_at: string;
  open_ended: boolean;
  status: string;
  charge_per_day: string;
  payout_per_day: string;
  payout_term: string;
  extra_partners: DutyFormExtraPartner[];
  materialize: boolean;
  notes: string;
  expected_updated_at: string;
}

interface CancelDialogState {
  id: string;
  reason: string;
}

interface DeleteDialogState {
  id: string;
  reason?: string;
  patient?: string;
  employee?: string;
  range?: string;
}

interface OverlapDialogState {
  kind: "patient" | "staff";
  message: string;
}

interface MaterializePreviewLine {
  date?: string;
  employee_name?: string;
  charge?: number;
  payout?: number;
  svc_action?: string;
  payout_action?: string;
}

interface MaterializePreviewData {
  would_create_svc?: number;
  would_update_svc?: number;
  would_create_payout?: number;
  would_update_payout?: number;
  would_delete_svc?: number;
  would_delete_payout?: number;
  preview?: MaterializePreviewLine[];
}

interface PreviewDialogState {
  dutyId: string;
  data: MaterializePreviewData;
}

interface DiaryEditDraft {
  charge?: string;
  payout?: string;
  employee_id?: string;
}

interface DutyPatientTotals {
  billed?: number;
  received?: number;
  outstanding?: number;
  sec_dep?: number;
  bills?: number;
}

interface DutyPartnerTotals {
  charged?: number;
  paid?: number;
  pending?: number;
}

interface DutyTotalsBundle {
  patient?: DutyPatientTotals;
  partner?: DutyPartnerTotals;
}

interface OutstandingState {
  billing_id: string;
  totals?: { outstanding?: number } | null;
}

interface CalendarTotalsStripeProps {
  totals: DutyTotalsBundle | null;
  patientId: string;
  employeeId: string;
  period: string;
}

interface FinancialBifurcationProps {
  totals: DutyTotalsBundle | null;
  outstanding: OutstandingState | null;
  patientId: string;
  employeeId: string;
}

function sessionOrNull(auth: DutiesAuth) {
  return (auth.session ?? null) as import("@supabase/supabase-js").Session | null;
}

function roleInList(role: unknown, list: readonly Role[]): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

/** Server-computed flags from GET/list; deny-all when missing (legacy rows). */
function dutyRowPermissions(row: DutyListRow): DutyPermissionsDto {
  return (
    row.permissions || {
      canEdit: false,
      canCancel: false,
      canCheckIn: false,
      canCheckOut: false,
      canMaterialize: false,
      canHardDelete: false
    }
  );
}

function createInitialForm(): DutyFormState {
  const start = new Date();
  start.setHours(8, 0, 0, 0);
  const pad = function (n: number) {
    return String(n).padStart(2, "0");
  };
  const localDefault =
    start.getFullYear() +
    "-" +
    pad(start.getMonth() + 1) +
    "-" +
    pad(start.getDate()) +
    "T" +
    pad(start.getHours()) +
    ":" +
    pad(start.getMinutes());
  return {
    id: "",
    patient_id: "",
    employee_id: "",
    service_name: "Care Taker Services",
    shift_type: "DAY",
    start_at: localDefault,
    end_at: "",
    open_ended: true,
    status: "SCHEDULED",
    charge_per_day: "",
    payout_per_day: "",
    payout_term: "Daily",
    extra_partners: [],
    materialize: true,
    notes: "",
    expected_updated_at: ""
  };
}

function toIsoFromLocal(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = function (n: number) {
    return String(n).padStart(2, "0");
  };
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

const SHIFT_CHIP_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  DAY: { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  NIGHT: { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
  "24H": { bg: "#ffedd5", border: "#ea580c", text: "#9a3412" },
  FULL: { bg: "#dcfce7", border: "#16a34a", text: "#14532d" }
};

function shiftChipStyle(shift: unknown) {
  return SHIFT_CHIP_STYLES[String(shift || "DAY").toUpperCase()] || SHIFT_CHIP_STYLES.DAY!;
}

function shortLabel(name: unknown, id: unknown) {
  const n = String(name || id || "").trim();
  if (n.length <= 14) return n;
  return n.slice(0, 12) + "…";
}

function dutyMatchesEmployee(row: DutyListRow, employeeId: string): boolean {
  if (!employeeId) return true;
  if (row.employee_id === employeeId) return true;
  const extras = row.extra_partners;
  if (!Array.isArray(extras)) return false;
  return extras.some(function (p) {
    return p && p.employee_id === employeeId;
  });
}

function CalendarTotalsStripe(props: CalendarTotalsStripeProps) {
  const totals = props.totals;
  const patientFilter = props.patientId;
  const employeeFilter = props.employeeId;
  const period = props.period;
  const pill = function (label: string, amount: string, tone: string) {
    const color = tone === "danger" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#15803d";
    return (
      <span
        key={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          fontSize: 13
        }}
      >
        <span className="mini-muted">{label}</span>
        <strong style={{ color: color }}>{amount}</strong>
      </span>
    );
  };

  const pills = [];
  if (patientFilter && totals && totals.patient) {
    pills.push(
      pill(
        "Patient outstanding",
        formatCurrency(totals.patient.outstanding),
        (totals.patient.outstanding ?? 0) > 0 ? "danger" : "ok"
      )
    );
    if (totals.patient.sec_dep) {
      pills.push(pill("Security dep.", formatCurrency(totals.patient.sec_dep), "ok"));
    }
  }
  if (employeeFilter && totals && totals.partner) {
    pills.push(
      pill(
        "Partner pending" + (period ? " (" + period + ")" : ""),
        formatCurrency(totals.partner.pending),
        (totals.partner.pending ?? 0) > 0 ? "warn" : "ok"
      )
    );
    if (period) {
      pills.push(
        <a
          key="open-in-payouts"
          href={
            "/payouts?employee_id=" +
            encodeURIComponent(employeeFilter) +
            "&period=" +
            encodeURIComponent(period)
          }
          className="button secondary"
          style={{ padding: "4px 10px", fontSize: 13 }}
        >
          Open in Payouts →
        </a>
      );
    }
  }

  if (!pills.length && (patientFilter || employeeFilter)) {
    pills.push(
      <span key="loading" className="mini-muted" style={{ fontSize: 13 }} role="status" aria-live="polite">
        Loading totals…
      </span>
    );
  }
  if (!pills.length) {
    pills.push(
      <span key="empty" className="mini-muted" style={{ fontSize: 13 }}>
        Filter by patient or caretaker to see live outstanding and payout totals.
      </span>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        padding: "8px 12px",
        marginBottom: 10,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8
      }}
    >
      <strong style={{ fontSize: 13, marginRight: 4 }}>Totals</strong>
      {pills}
    </div>
  );
}

function FinancialBifurcation(props: FinancialBifurcationProps) {
  const totals = props.totals;
  const outstanding = props.outstanding;
  if (!props.patientId && !props.employeeId) return null;
  return (
    <div
      className="helper-box"
      style={{
        gridColumn: "1 / -1",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        marginTop: 4
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Outstanding & payout</div>
      {props.patientId && totals && totals.patient ? (
        <div>
          <span className="mini-muted">Patient · </span>
          billed {formatCurrency(totals.patient.billed)} · received{" "}
          {formatCurrency(totals.patient.received)} ·{" "}
          <strong style={{ color: (totals.patient.outstanding ?? 0) > 0 ? "#b91c1c" : "#15803d" }}>
            outstanding {formatCurrency(totals.patient.outstanding)}
          </strong>
          {totals.patient.sec_dep ? " · sec.dep " + formatCurrency(totals.patient.sec_dep) : ""}
          <span className="mini-muted"> · {totals.patient.bills} bill(s)</span>
        </div>
      ) : props.patientId && outstanding && outstanding.totals ? (
        <div>
          <span className="mini-muted">Active bill {outstanding.billing_id} · </span>
          outstanding {formatCurrency(outstanding.totals.outstanding)}
        </div>
      ) : props.patientId ? (
        <div className="mini-muted">No billing on file for this patient</div>
      ) : null}
      {props.employeeId && totals && totals.partner ? (
        <div style={{ marginTop: totals.patient || outstanding ? 6 : 0 }}>
          <span className="mini-muted">Partner · </span>
          earned {formatCurrency(totals.partner.charged)} · paid{" "}
          {formatCurrency(totals.partner.paid)} ·{" "}
          <strong style={{ color: (totals.partner.pending ?? 0) > 0 ? "#b45309" : "#15803d" }}>
            net pending payout {formatCurrency(totals.partner.pending)}
          </strong>
        </div>
      ) : props.employeeId ? (
        <div className="mini-muted" style={{ marginTop: 6 }} role="status" aria-live="polite">
          Loading partner payout…
        </div>
      ) : null}
    </div>
  );
}

export default function DutiesPage() {
  const auth = useAuth() as unknown as DutiesAuth;
  const accessToken = sessionOrNull(auth)?.access_token ?? "";
  // P1-B: pin latest session/supabase so memoized loaders never close over
  // stale auth after onAuthStateChange re-renders the provider.
  const sessionRef = useRef(sessionOrNull(auth));
  sessionRef.current = sessionOrNull(auth);
  const supabaseRef = useRef(auth.supabase);
  supabaseRef.current = auth.supabase;
  const canWrite = roleInList(auth.profile?.role, DUTY_WRITE_ROLES);
  const canCancel = roleInList(auth.profile?.role, DUTY_CANCEL_ROLES);
  const canCheckIn = roleInList(auth.profile?.role, DUTY_CHECK_IN_ROLES);
  const canMaterialize = roleInList(auth.profile?.role, DUTY_MATERIALIZE_ROLES);
  const canDiaryEdit = roleInList(auth.profile?.role, DUTY_DIARY_WRITE_ROLES);
  const canHardDelete = roleInList(auth.profile?.role, DUTY_DELETE_ROLES);
  const [viewMonth, setViewMonth] = useState(monthKey(new Date()));
  const [rows, setRows] = useState<DutyListRow[]>([]);
  // P1-28: track API limit + server total for the "Showing first N of M"
  // truncation banner. The duties calendar capped the month view at 150
  // duties; high-volume care managers couldn't tell when the second half of
  // the month was missing from the calendar.
  const DUTIES_LIMIT = 150;
  const [rowsTotal, setRowsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<LookupRow[]>([]);
  const [employees, setEmployees] = useState<LookupRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [filterPatient, setFilterPatient] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [form, setForm] = useState<DutyFormState>(createInitialForm);
  const [formPermissions, setFormPermissions] = useState<DutyPermissionsDto | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const { busy, tryBegin, end } = useBusyGuard();
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  const lastErrorToastRef = useRef({ message: "", at: 0 });
  const setError = useCallback(function (msg: string) {
    let text = String(msg || "").trim();
    if (text.includes("auth/v1/user") || text.includes("supabase.co/auth")) {
      text =
        "Supabase connection failed — check NEXT_PUBLIC_SUPABASE_URL on Vercel matches project hkyjxdmkqkydnrafhpgn.";
    }
    setErrorState(text);
    if (!text) return;
    const now = Date.now();
    const prev = lastErrorToastRef.current;
    if (prev.message === text && now - prev.at < 4000) return;
    lastErrorToastRef.current = { message: text, at: now };
    toast.error(text);
  }, [toast]);
  const setMessage = useCallback(function (msg: string) {
    const text = String(msg || "");
    setMessageState(text);
    if (text) toast.success(text);
  }, [toast]);
  const [cancelDialog, setCancelDialog] = useState<CancelDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [overlapDialog, setOverlapDialog] = useState<OverlapDialogState | null>(null);
  const [conflictBanner, setConflictBanner] = useState("");
  const [outstanding, setOutstanding] = useState<OutstandingState | null>(null);
  const [totals, setTotals] = useState<DutyTotalsBundle | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState | null>(null);
  const [filterTotals, setFilterTotals] = useState<DutyTotalsBundle | null>(null);
  const [diaryByDuty, setDiaryByDuty] = useState<Record<string, DutyDiaryEntry[]>>({});
  const [diaryEdits, setDiaryEdits] = useState<Record<string, DiaryEditDraft>>({});
  const [diaryBusy, setDiaryBusy] = useState<Record<string, boolean>>({});

  const ym = useMemo(
    function () {
      const p = viewMonth.split("-");
      return { year: parseInt(p[0] || "", 10), monthIndex: parseInt(p[1] || "1", 10) - 1 };
    },
    [viewMonth]
  );

  const calendarCells = useMemo(
    function () {
      return daysInMonthGrid(ym.year, ym.monthIndex);
    },
    [ym]
  );

  const reloadRef = useRef(function () {});
  const diaryByDutyRef = useRef(diaryByDuty);
  const viewMonthRef = useRef(viewMonth);

  useEffect(
    function () {
      diaryByDutyRef.current = diaryByDuty;
    },
    [diaryByDuty]
  );
  useEffect(
    function () {
      viewMonthRef.current = viewMonth;
    },
    [viewMonth]
  );

  const loadDiaryFor = useCallback(
    async function loadDiaryFor(dutyId: string) {
      if (!dutyId || !accessToken) return;
      const session = sessionRef.current;
      if (!session) return;
      try {
        const data = (await dutiesClient.diary(session, dutyId)) as {
          entries?: DutyDiaryEntry[];
        };
        setDiaryByDuty(function (cur) {
          const next = { ...cur };
          next[dutyId] = Array.isArray(data?.entries) ? data.entries : [];
          return next;
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load day-wise entries");
      }
    },
    [accessToken, setError]
  );

  const loadDiariesForVisible = useCallback(
    async function loadDiariesForVisible(rowList: DutyListRow[]) {
      if (!accessToken || !rowList || !rowList.length) return;
      const session = sessionRef.current;
      if (!session) return;
      const ids = rowList.map(function (r) {
        return r.id;
      }).filter(Boolean);
      if (!ids.length) return;
      try {
        const data = await dutiesClient.diaryBatch(session, ids);
        const map =
          data && typeof data === "object"
            ? (data as Record<string, { entries?: DutyDiaryEntry[] }>)
            : {};
        setDiaryByDuty(function (cur) {
          const next = { ...cur };
          ids.forEach(function (id) {
            const entry = map[id];
            if (entry && Array.isArray(entry.entries)) {
              next[id] = entry.entries;
            } else if (!next[id]) {
              next[id] = [];
            }
          });
          return next;
        });
      } catch (_e) {
        const pairs = await Promise.all(
          ids.map(async function (id) {
            try {
              const d = await dutiesClient.diary(session, id);
              return [id, Array.isArray(d?.entries) ? d.entries : []];
            } catch (_err) {
              return [id, []];
            }
          })
        );
        setDiaryByDuty(function (cur) {
          const next = { ...cur };
          pairs.forEach(function (p) {
            next[p[0]] = p[1];
          });
          return next;
        });
      }
    },
    [accessToken]
  );

  const loadOutstanding = useCallback(
    async function loadOutstanding(patientId: string) {
      if (!patientId || !accessToken) {
        setOutstanding(null);
        return;
      }
      const session = sessionRef.current;
      if (!session) return;
      try {
        const list = (await billingsClient.list(session, {
          limit: 20,
          patient_id: patientId,
          status: "Active"
        })) as { rows?: Array<{ id: string; status?: string }> };
        const billRows = Array.isArray(list?.rows) ? list.rows : [];
        const active = billRows.find(function (b) {
          return b.status === "Active";
        });
        if (!active) {
          setOutstanding(null);
          return;
        }
        const bundle = (await billingsClient.get(session, active.id)) as {
          totals?: OutstandingState["totals"];
        };
        setOutstanding({
          billing_id: active.id,
          totals: bundle.totals || null
        });
      } catch (_e) {
        setOutstanding(null);
      }
    },
    [accessToken]
  );

  const loadTotals = useCallback(
    async function loadTotals(
      patientId: string,
      employeeId: string,
      period: string
    ): Promise<DutyTotalsBundle | null> {
      if (!accessToken) {
        return null;
      }
      if (!patientId && !employeeId) {
        return null;
      }
      const session = sessionRef.current;
      if (!session) return null;
      try {
        return (await dutiesClient.totals(session, {
          patient_id: patientId || undefined,
          employee_id: employeeId || undefined,
          period: employeeId && period ? period : undefined
        })) as DutyTotalsBundle;
      } catch (_e) {
        return null;
      }
    },
    [accessToken]
  );

  const reload = useCallback(async function reload() {
    if (!accessToken) return;
    const session = sessionRef.current;
    if (!session) return;
    setLoading(true);
    try {
      if (filterPatient) {
        try {
          await billingsClient.syncDutyLedger(session, filterPatient);
        } catch (syncErr) {
          console.warn("[duties] duty→billing ledger sync failed", syncErr);
        }
      }
      // P1-20: bound the month window in IST (+05:30), not UTC. With a
      // UTC bound, queries near month-end on India time were returning
      // duties from the *next* month — e.g. a 31-Aug 11pm IST duty
      // landed on 1-Sep UTC and got hidden under the August filter.
      // crmDayStartIso/crmDayEndIso emit `+05:30` offsets so the bound
      // matches the user's calendar.
      const from = crmDayStartIso(viewMonth + "-01");
      const endDate = new Date(ym.year, ym.monthIndex + 1, 0);
      const endKey = endDate.getFullYear() + "-" + String(endDate.getMonth() + 1).padStart(2, "0") + "-" + String(endDate.getDate()).padStart(2, "0");
      const to = crmDayEndIso(endKey);
      const data = (await dutiesClient.list(session, {
        limit: DUTIES_LIMIT,
        from,
        to,
        status: statusFilter || undefined,
        patient_id: filterPatient || undefined,
        employee_id: filterEmployee || undefined
      })) as {
        rows?: DutyListRow[];
        total?: number;
      };
      let list = Array.isArray(data?.rows) ? data.rows : [];
      const serverTotal = Number(data && data.total != null ? data.total : list.length) || list.length;
      if (filterEmployee) {
        list = list.filter(function (r) {
          return dutyMatchesEmployee(r, filterEmployee);
        });
      }
      setRows(list);
      setRowsTotal(serverTotal);
      setError("");
      loadDiariesForVisible(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load duties");
    } finally {
      setLoading(false);
    }
  }, [
    accessToken,
    viewMonth,
    ym.year,
    ym.monthIndex,
    statusFilter,
    filterPatient,
    filterEmployee,
    loadDiariesForVisible,
    setError
  ]);

  useEffect(function () {
    reloadRef.current = reload;
  }, [reload]);

  async function refreshFormTotals() {
    const data = await loadTotals(form.patient_id, form.employee_id, viewMonth);
    setTotals(data || null);
  }

  useEffect(
    function () {
      if (!accessToken) return;
      reload();
    },
    [accessToken, reload]
  );

  // Realtime — when billing closes, duties cap, or diary rows change in
  // another tab, refresh the calendar without a manual reload.
  const filterPatientRef = useRef(filterPatient);
  const filterEmployeeRef = useRef(filterEmployee);
  useEffect(
    function () {
      filterPatientRef.current = filterPatient;
    },
    [filterPatient]
  );
  useEffect(
    function () {
      filterEmployeeRef.current = filterEmployee;
    },
    [filterEmployee]
  );
  useEffect(
    function () {
      const supabase = supabaseRef.current;
      if (!accessToken || !supabase) return undefined;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      let refreshInFlight = false;
      function scheduleRefresh() {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          debounce = null;
          if (refreshInFlight) return;
          refreshInFlight = true;
          Promise.resolve(reloadRef.current()).finally(function () {
            refreshInFlight = false;
          });
          const fp = filterPatientRef.current;
          const fe = filterEmployeeRef.current;
          if (fp || fe) {
            loadTotals(fp, fe, viewMonthRef.current).then(function (ft) {
              setFilterTotals(ft || null);
            });
          }
          if (fp) loadOutstanding(fp);
        }, 300);
      }
      const channel = supabase.channel("crm-hh_duties_calendar") as {
        on: (
          event: string,
          filter: object,
          handler: () => void
        ) => { on: (event: string, filter: object, handler: () => void) => unknown; subscribe: () => void };
        subscribe: () => void;
      };
      ["hh_duties", "hh_billings", "hh_svc_entries", "hh_payout_charges", "hh_attendance"].forEach(
        function (tableName) {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: tableName },
            scheduleRefresh
          );
        }
      );
      channel.subscribe();
      return function cleanup() {
        if (debounce) clearTimeout(debounce);
        const sb = supabaseRef.current;
        if (sb) sb.removeChannel(channel);
      };
      // P1-27: depend on access_token only; supabase client is read via ref.
    },
    [accessToken, loadOutstanding, loadTotals]
  );

  useEffect(
    function () {
      if (!accessToken) return;
      const session = sessionRef.current;
      if (!session) return;
      lookupsClient
        .patients(session)
        .then(function (rows) {
          const arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setPatients(arr);
        })
        .catch(function () { setPatients([]); });
      lookupsClient
        .employees(session)
        .then(function (rows) {
          const arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setEmployees(arr);
        })
        .catch(function () { setEmployees([]); });
      lookupsClient
        .services(session)
        .then(function (rows) {
          const arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setServices(arr);
        })
        .catch(function () { setServices([]); });
    },
    [accessToken]
  );

  useEffect(
    function () {
      loadOutstanding(form.patient_id || filterPatient);
    },
    [form.patient_id, filterPatient, loadOutstanding]
  );

  useEffect(
    function () {
      if (!form.patient_id && !form.employee_id) {
        setTotals(null);
        return;
      }
      loadTotals(form.patient_id, form.employee_id, viewMonth).then(function (data) {
        setTotals(data || null);
      });
    },
    [form.patient_id, form.employee_id, viewMonth, loadTotals]
  );

  useEffect(
    function () {
      if (!filterPatient && !filterEmployee) {
        setFilterTotals(null);
        return;
      }
      loadTotals(filterPatient, filterEmployee, viewMonth).then(function (data) {
        setFilterTotals(data || null);
      });
    },
    [filterPatient, filterEmployee, viewMonth, loadTotals]
  );

  const patientNameById = useMemo(
    function () {
      const map: Record<string, string> = {};
      patients.forEach(function (p) {
        map[p.id] = p.name || p.full_name || p.id;
      });
      return map;
    },
    [patients]
  );

  const employeeNameById = useMemo(
    function () {
      const map: Record<string, string> = {};
      employees.forEach(function (e) {
        map[e.id] = e.full_name || e.name || e.id;
      });
      return map;
    },
    [employees]
  );

  const dayDuties = useMemo(
    function () {
      if (!selectedDay) return [];
      return rows.filter(function (r) {
        return dutyTouchesDay(r, selectedDay);
      });
    },
    [rows, selectedDay]
  );

  useEffect(
    function () {
      if (!selectedDay) return;
      dayDuties.forEach(function (d) {
        if (!diaryByDutyRef.current[d.id]) loadDiaryFor(d.id);
      });
    },
    [selectedDay, dayDuties, loadDiaryFor]
  );

  function updateField<K extends keyof DutyFormState>(name: K, value: DutyFormState[K]) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setFormPermissions(null);
    setConflictBanner("");
    setError("");
    setMessage("");
  }

  function editDuty(row: DutyListRow) {
    const openEnded = isOpenEndedIso(row.end_at);
    setForm({
      id: row.id,
      patient_id: row.patient_id || "",
      employee_id: row.employee_id || "",
      service_name: row.service_name || row.service_type || "Care Taker Services",
      shift_type: row.shift_type || "DAY",
      start_at: toLocalDatetimeValue(row.start_at),
      end_at: openEnded ? "" : toLocalDatetimeValue(row.end_at),
      open_ended: openEnded,
      status: row.status || "SCHEDULED",
      charge_per_day: row.charge_per_day != null ? String(row.charge_per_day) : "",
      payout_per_day: row.payout_per_day != null ? String(row.payout_per_day) : "",
      payout_term: row.payout_term || "Daily",
      extra_partners: Array.isArray(row.extra_partners)
        ? row.extra_partners.map(function (p) {
            return {
              row_id: newExtraPartnerRowId(),
              employee_id: p.employee_id || "",
              charge_per_day: p.charge_per_day != null ? String(p.charge_per_day) : "",
              payout_per_day: p.payout_per_day != null ? String(p.payout_per_day) : "",
              payout_term: p.payout_term || "Daily"
            };
          })
        : [],
      materialize: true,
      notes: row.notes || "",
      expected_updated_at: row.updated_at || ""
    });
    setFormPermissions(dutyRowPermissions(row));
    setSelectedDay(istDayKey(row.start_at));
    if (!row.updated_at) {
      setMessage(
        "Loaded a legacy duty without a last-modified timestamp — concurrent edit detection is disabled. Save with care."
      );
    }
  }

  function addExtraPartner() {
    setForm(function (current) {
      return {
        ...current,
        extra_partners: current.extra_partners.concat([emptyExtraPartner()])
      };
    });
  }

  function updateExtraPartner(
    index: number,
    key: keyof DutyFormExtraPartner,
    value: string
  ) {
    setForm(function (current) {
      const list = current.extra_partners.slice();
      list[index] = { ...(list[index] || emptyExtraPartner()), [key]: value };
      return { ...current, extra_partners: list };
    });
  }

  function removeExtraPartner(index: number) {
    setForm(function (current) {
      const list = current.extra_partners.slice();
      list.splice(index, 1);
      return { ...current, extra_partners: list };
    });
  }

  function buildPayload(confirm?: { staff?: boolean; patient?: boolean }) {
    const confirmObj = confirm || {};
    const payload: Record<string, unknown> = {
      patient_id: form.patient_id,
      employee_id: form.employee_id,
      service_name: form.service_name,
      service_type: form.service_name,
      shift_type: form.shift_type,
      start_at: toIsoFromLocal(form.start_at),
      status: form.status,
      notes: form.notes,
      charge_per_day: Number(form.charge_per_day || 0),
      payout_per_day: Number(form.payout_per_day || 0),
      payout_term: form.payout_term,
      extra_partners: form.extra_partners
        .filter(function (p) {
          return p.employee_id;
        })
        .map(function (p) {
          return {
            employee_id: p.employee_id,
            charge_per_day: Number(p.charge_per_day || form.charge_per_day || 0),
            payout_per_day: Number(p.payout_per_day || form.payout_per_day || 0),
            payout_term: p.payout_term || form.payout_term
          };
        }),
      materialize: form.materialize,
      expected_updated_at: form.expected_updated_at || undefined,
      confirm_staff_overlap: !!confirmObj.staff,
      confirm_patient_overlap: !!confirmObj.patient
    };
    if (!form.open_ended && form.end_at) {
      payload.end_at = toIsoFromLocal(form.end_at);
    }
    return payload;
  }

  async function submitPayload(payload: Record<string, unknown>) {
    await dutiesClient.save(sessionOrNull(auth), form.id || undefined, payload);
    await reload();
    await loadOutstanding(form.patient_id);
    await refreshFormTotals();
    resetForm();
    setMessage(form.id ? "Duty updated — diary rows synced when materialize is on" : "Duty created");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      setError("You do not have permission to create or edit duties.");
      return;
    }
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    setConflictBanner("");
    try {
      await submitPayload(buildPayload({}));
    } catch (submitError: unknown) {
      const err = submitError as {
        message?: string;
        code?: string;
        details?: { field?: string };
      };
      const msg = String(err.message || "").toLowerCase();
      const code = err.code || "";
      const details = err.details || {};
      const field = String(details.field || "");
      if (field === "patient_window" || msg.indexOf("patient already has another duty") >= 0) {
        setOverlapDialog({
          kind: "patient",
          message: err.message || "Patient already has another duty overlapping this time"
        });
      } else if (
        field === "employee_window" ||
        msg.indexOf("staff already has a duty") >= 0 ||
        msg.indexOf("overlapping") >= 0 ||
        code === "DUPLICATE"
      ) {
        setOverlapDialog({
          kind: "staff",
          message: err.message || "Staff has another overlapping duty"
        });
      } else if (code === "conflict" || msg.indexOf("stale") >= 0 || msg.indexOf("modified by another") >= 0) {
        setConflictBanner(err.message || "Record changed elsewhere — reload and retry");
        setError(err.message || "Unable to save duty");
      } else {
        setError(err.message || "Unable to save duty");
      }
    } finally {
      end();
    }
  }

  async function confirmOverlapAndSave() {
    if (!tryBegin()) return;
    setError("");
    try {
      const kind = (overlapDialog && overlapDialog.kind) || "staff";
      const confirmFlags = kind === "patient" ? { patient: true } : { staff: true };
      await submitPayload(buildPayload(confirmFlags));
      setOverlapDialog(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      end();
    }
  }

  async function runMaterialize(dutyId: string, skipPreview?: boolean) {
    if (!skipPreview) {
      if (!tryBegin()) return;
      setError("");
      try {
        const preview = await dutiesClient.materialize(sessionOrNull(auth), dutyId, { dry_run: true });
        setPreviewDialog({
          dutyId: dutyId,
          data: (preview || {}) as MaterializePreviewData
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Preview failed");
      } finally {
        end();
      }
      return;
    }
    if (!tryBegin()) return;
    setError("");
    try {
      const data = (await dutiesClient.materialize(sessionOrNull(auth), dutyId)) as {
        created_svc?: number;
        created_payout?: number;
        updated_svc?: number;
        updated_payout?: number;
        deleted_svc?: number;
        deleted_payout?: number;
      };
      setPreviewDialog(null);
      setMessage(
        "Diary synced: +" +
          (data.created_svc || 0) +
          "/" +
          (data.created_payout || 0) +
          " created, " +
          (data.updated_svc || 0) +
          "/" +
          (data.updated_payout || 0) +
          " updated, " +
          (data.deleted_svc || 0) +
          "/" +
          (data.deleted_payout || 0) +
          " removed"
      );
      await reload();
      await loadOutstanding(form.patient_id || filterPatient);
      await refreshFormTotals();
      if (filterPatient || filterEmployee) {
        const ft = await loadTotals(filterPatient, filterEmployee, viewMonth);
        setFilterTotals(ft || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Materialize failed");
    } finally {
      end();
    }
  }

  async function confirmCancel() {
    if (!cancelDialog) return;
    if (!tryBegin()) return;
    try {
      await dutiesClient.cancel(sessionOrNull(auth), cancelDialog.id, {
        reason: cancelDialog.reason || ""
      });
      setCancelDialog(null);
      await reload();
      setMessage("Duty cancelled — diary rows removed when safe");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      end();
    }
  }

  async function confirmHardDelete() {
    if (!deleteDialog) return;
    if (!tryBegin()) return;
    setError("");
    try {
      await dutiesClient.hardDelete(sessionOrNull(auth), deleteDialog.id);
      setDeleteDialog(null);
      await reload();
      setMessage("Duty deleted — diary rows removed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      end();
    }
  }

  function diaryKey(dutyId: string, isoDate: string, employeeId: string) {
    return dutyId + "|" + isoDate + "|" + employeeId;
  }

  function startEditDay(dutyId: string, entry: DutyDiaryEntry) {
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    setDiaryEdits(function (cur) {
      const next = { ...cur };
      next[k] = {
        charge: String(entry.charge ?? ""),
        payout: String(entry.payout ?? ""),
        employee_id: entry.employee_id
      };
      return next;
    });
  }

  function cancelEditDay(dutyId: string, entry: DutyDiaryEntry) {
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    setDiaryEdits(function (cur) {
      const next = { ...cur };
      delete next[k];
      return next;
    });
  }

  function updateDayField(
    dutyId: string,
    entry: DutyDiaryEntry,
    field: keyof DiaryEditDraft,
    value: string
  ) {
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    setDiaryEdits(function (cur) {
      const next = { ...cur };
      next[k] = { ...(next[k] || {}), [field]: value };
      return next;
    });
  }

  async function saveDayEdit(dutyId: string, entry: DutyDiaryEntry) {
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    const draft = diaryEdits[k] || {};
    const newEmp = draft.employee_id && draft.employee_id !== entry.employee_id ? draft.employee_id : undefined;
    setDiaryBusy(function (cur) { const n = { ...cur }; n[k] = true; return n; });
    try {
      await dutiesClient.patchDiaryDay(sessionOrNull(auth), dutyId, entry.date, {
        employee_id: entry.employee_id,
        new_employee_id: newEmp,
        charge: draft.charge === "" ? undefined : Number(draft.charge),
        payout: draft.payout === "" ? undefined : Number(draft.payout),
        svc_updated_at: entry.svc_updated_at || undefined,
        payout_updated_at: entry.payout_updated_at || undefined
      });
      cancelEditDay(dutyId, entry);
      await loadDiaryFor(dutyId);
      // If we reassigned a partner the server promotes the target into
      // hh_duties.extra_partners — refresh the duty rows so the
      // calendar swimlane re-renders with the new partner list.
      if (newEmp) {
        await reload();
      }
      if (filterPatient || filterEmployee) {
        const ft = await loadTotals(filterPatient, filterEmployee, viewMonth);
        setFilterTotals(ft || null);
      }
      setMessage(newEmp ? "Day entry reassigned and saved (marked manual)" : "Day entry saved (marked manual — will resist next sync)");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save day entry");
    } finally {
      setDiaryBusy(function (cur) { const n = { ...cur }; delete n[k]; return n; });
    }
  }

  async function clearDayManual(dutyId: string, entry: DutyDiaryEntry) {
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    setDiaryBusy(function (cur) { const n = { ...cur }; n[k] = true; return n; });
    try {
      await dutiesClient.patchDiaryDay(sessionOrNull(auth), dutyId, entry.date, {
        employee_id: entry.employee_id,
        clear_manual: true
      });
      await loadDiaryFor(dutyId);
      setMessage("Manual lock removed — next sync will reconcile this day");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not unlock day entry");
    } finally {
      setDiaryBusy(function (cur) { const n = { ...cur }; delete n[k]; return n; });
    }
  }

  async function deleteDay(dutyId: string, entry: DutyDiaryEntry) {
    const ok = await confirm({
      title: "Remove diary entry?",
      description:
        "Remove diary entry for " +
        entry.date +
        "? This day will stay excluded from billing and payout until you edit the duty window.",
      confirmLabel: "Remove",
      tone: "danger"
    });
    if (!ok) return;
    const k = diaryKey(dutyId, entry.date, entry.employee_id);
    setDiaryBusy(function (cur) { const n = { ...cur }; n[k] = true; return n; });
    try {
      await dutiesClient.deleteDiaryDay(
        sessionOrNull(auth),
        dutyId,
        entry.date,
        entry.employee_id
      );
      await loadDiaryFor(dutyId);
      if (filterPatient || filterEmployee) {
        const ft = await loadTotals(filterPatient, filterEmployee, viewMonth);
        setFilterTotals(ft || null);
      }
      setMessage("Day excluded — sync will not recreate this entry");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete day entry");
    } finally {
      setDiaryBusy(function (cur) { const n = { ...cur }; delete n[k]; return n; });
    }
  }

  async function runDutyAction(id: string, action: string) {
    if (!tryBegin()) return;
    setError("");
    try {
      await dutiesClient.runAction(sessionOrNull(auth), id, action);
      await reload();
      setMessage("Duty " + action.replace("-", " "));
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      end();
    }
  }

  function shiftMonth(delta: number) {
    const d = new Date(ym.year, ym.monthIndex + delta, 1);
    setViewMonth(monthKey(d));
  }

  function dutiesOnDay(isoDay: string) {
    return rows.filter(function (r) {
      return dutyTouchesDay(r, isoDay);
    });
  }

  /**
   * Effective partner names for a given duty on a given calendar day.
   * Prefers the materialized diary entries (so reassignments + extra
   * partners show up), and falls back to the duty's primary employee
   * when nothing has been materialized yet.
   */
  function partnersForDutyDay(
    row: DutyListRow,
    isoDay: string
  ): Array<{ employee_id: string; partner: string; manual: boolean }> {
    const entries = diaryByDuty[row.id] || [];
    const dayEntries = entries.filter(function (e) { return e.date === isoDay; });
    // Always prefer the lookup name — older diary rows persisted the
    // employee_id in the `partner` column (server-side fn/mn/ln bug),
    // so we'd otherwise render "EMP640207047" forever on those rows.
    function displayFor(empId: string, storedPartner: string | undefined) {
      return partnerDisplayName(empId, storedPartner, employeeNameById);
    }
    if (dayEntries.length) {
      return dayEntries.map(function (e) {
        const empId = e.employee_id || "";
        return {
          employee_id: empId,
          partner: displayFor(empId, e.partner),
          manual: !!e.manual
        };
      });
    }
    return [
      {
        employee_id: row.employee_id || "",
        partner: displayFor(row.employee_id || "", ""),
        manual: false
      }
    ];
  }

  function filterPartnersForActiveCaretaker<T extends { employee_id: string }>(items: T[]): T[] {
    if (!filterEmployee) return items;
    return items.filter(function (item) {
      return item.employee_id === filterEmployee;
    });
  }

  return (
    <AuthGuard permission="duties.read">
      <AppShell title="Duty calendar">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit duty assignment" : "New duty assignment"}
            description="Per-day patient charges and partner payouts sync to billing (legacy duty diary parity)"
          >
            {!canWrite ? (
              <div className="info-text" role="status">
                You have read-only access. Only Admin, Manager, and Staff can create or edit duties.
              </div>
            ) : null}
            <fieldset
              className="stack"
              style={{ border: 0, padding: 0, margin: 0 }}
              disabled={Boolean(
                !canWrite || (form.id && formPermissions && !formPermissions.canEdit)
              )}
            >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="duties-patient-1">Patient</label>
                  <select id="duties-patient-1"
                    value={form.patient_id}
                    onChange={function (event) {
                      updateField("patient_id", event.target.value);
                    }}
                    required
                  >
                    <option value="">Select patient</option>
                    {patients.map(function (p) {
                      const label = p.name || p.full_name || p.id;
                      return (
                        <option key={p.id} value={p.id}>
                          {label + " (" + p.id + ")"}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="duties-primary-partner-employee-2">Primary partner (employee)</label>
                  <select id="duties-primary-partner-employee-2"
                    value={form.employee_id}
                    onChange={function (event) {
                      updateField("employee_id", event.target.value);
                    }}
                    required
                  >
                    <option value="">Select staff</option>
                    {employees.map(function (e) {
                      return (
                        <option key={e.id} value={e.id}>
                          {(e.full_name || e.name) + " (" + e.id + ")"}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <FinancialBifurcation
                patientId={form.patient_id}
                employeeId={form.employee_id}
                totals={totals}
                outstanding={outstanding}
              />

              <div className="grid-2">
                <div className="field">
                  <label htmlFor="duties-service-3">Service</label>
                  <select id="duties-service-3"
                    value={form.service_name}
                    onChange={function (event) {
                      updateField("service_name", event.target.value);
                    }}
                  >
                    <option value="Care Taker Services">Care Taker Services</option>
                    {services.map(function (s, idx) {
                      const name = typeof s === "string" ? s : s.name || s.label || "";
                      if (!name || name === "Care Taker Services") return null;
                      return (
                        <option key={name + idx} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="duties-shift-4">Shift</label>
                  <select id="duties-shift-4"
                    value={form.shift_type}
                    onChange={function (event) {
                      updateField("shift_type", event.target.value);
                    }}
                  >
                    <option value="DAY">Day</option>
                    <option value="NIGHT">Night</option>
                    <option value="24H">24H</option>
                    <option value="FULL">Full</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="duties-charge-day-to-patient-5">Charge / day (₹ to patient)</label>
                  <input id="duties-charge-day-to-patient-5"
                    type="number"
                    min="0"
                    step="1"
                    value={form.charge_per_day}
                    onChange={function (event) {
                      updateField("charge_per_day", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="duties-payout-day-to-partner-6">Payout / day (₹ to partner)</label>
                  <input id="duties-payout-day-to-partner-6"
                    type="number"
                    min="0"
                    step="1"
                    value={form.payout_per_day}
                    onChange={function (event) {
                      updateField("payout_per_day", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="duties-payout-term-7">Payout term</label>
                  <input id="duties-payout-term-7"
                    value={form.payout_term}
                    onChange={function (event) {
                      updateField("payout_term", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="duties-start-8">Start</label>
                  <input id="duties-start-8"
                    type="datetime-local"
                    value={form.start_at}
                    onChange={function (event) {
                      updateField("start_at", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="duties-end-9">End</label>
                  <input id="duties-end-9"
                    type="datetime-local"
                    value={form.end_at}
                    disabled={form.open_ended}
                    min={form.start_at || undefined}
                    onChange={function (event) {
                      updateField("end_at", event.target.value);
                    }}
                  />
                  <label htmlFor="duties-input-10" className="checkbox-row" style={{ marginTop: 6 }}>
                    <input id="duties-input-10"
                      type="checkbox"
                      checked={form.open_ended}
                      onChange={function (event) {
                        updateField("open_ended", event.target.checked);
                        if (event.target.checked) updateField("end_at", "");
                      }}
                    />
                    Open-ended (run daily until the patient&apos;s active bill is closed)
                  </label>
                </div>
              </div>

              <div className="panel detail-card">
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <strong>Additional partners (same patient)</strong>
                  <button className="button secondary" type="button" onClick={addExtraPartner}>
                    + Add partner
                  </button>
                </div>
                {!form.extra_partners.length ? (
                  <div className="mini-muted" style={{ marginTop: 8 }}>
                    Optional — assign a second caretaker on the same patient; each gets their own charge and payout row per day.
                  </div>
                ) : (
                  form.extra_partners.map(function (p, idx) {
                    const partnerId = "duties-partner-" + p.row_id;
                    const chargeId = "duties-partner-charge-" + p.row_id;
                    const payoutId = "duties-partner-payout-" + p.row_id;
                    return (
                      <div className="grid-2" key={p.row_id} style={{ marginTop: 12 }}>
                        <div className="field">
                          <label htmlFor={partnerId}>Partner</label>
                          <select
                            id={partnerId}
                            value={p.employee_id}
                            onChange={function (event) {
                              updateExtraPartner(idx, "employee_id", event.target.value);
                            }}
                          >
                            <option value="">Select</option>
                            {employees.map(function (e) {
                              return (
                                <option key={e.id} value={e.id}>
                                  {e.full_name || e.name}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <div className="grid-2">
                            <div className="field">
                              <label htmlFor={chargeId}>Charge (₹)</label>
                            <input
                              id={chargeId}
                              type="number"
                              placeholder="Charge"
                              value={p.charge_per_day}
                              onChange={function (event) {
                                updateExtraPartner(idx, "charge_per_day", event.target.value);
                              }}
                            />
                            </div>
                            <div className="field">
                              <label htmlFor={payoutId}>Payout (₹)</label>
                            <input
                              id={payoutId}
                              type="number"
                              placeholder="Payout"
                              value={p.payout_per_day}
                              onChange={function (event) {
                                updateExtraPartner(idx, "payout_per_day", event.target.value);
                              }}
                            />
                            </div>
                          </div>
                        </div>
                        <button
                          className="button danger"
                          type="button"
                          onClick={function () {
                            removeExtraPartner(idx);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <label htmlFor="duties-input-13" className="checkbox-row">
                <input id="duties-input-13"
                  type="checkbox"
                  checked={form.materialize}
                  onChange={function (event) {
                    updateField("materialize", event.target.checked);
                  }}
                />
                Auto-add charges + payouts to active bill every day (stops when bill closes)
              </label>

              <textarea
                rows={2}
                value={form.notes}
                onChange={function (event) {
                  updateField("notes", event.target.value);
                }}
                placeholder="Notes"
              />

              <ErrorBanner message={conflictBanner} />
              <ErrorBanner message={error} />
              <SuccessBanner message={message} />

              <div className="button-row">
                <button
                  className="button primary"
                  type="submit"
                  disabled={Boolean(
                    busy ||
                    !canWrite ||
                    (form.id && formPermissions && !formPermissions.canEdit)
                  )}
                  title={
                    formPermissions && formPermissions.blockReasons
                      ? formPermissions.blockReasons.canEdit
                      : undefined
                  }
                >
                  {busy ? "Saving…" : form.id ? "Update duty" : "Save & materialize"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
            </fieldset>
          </ModuleShell>

          <ModuleShell
            title={"Calendar · " + viewMonth}
            description="Click a day to see assignments. Charges flow to Billing outstanding automatically."
            actions={
              <div className="button-row">
                <button className="button secondary" type="button" onClick={function () { shiftMonth(-1); }}>
                  ←
                </button>
                <button className="button secondary" type="button" onClick={reload}>
                  Refresh
                </button>
                <button className="button secondary" type="button" onClick={function () { shiftMonth(1); }}>
                  →
                </button>
              </div>
            }
          >
            <CalendarTotalsStripe
              patientId={filterPatient}
              employeeId={filterEmployee}
              totals={filterTotals}
              period={viewMonth}
            />

            <div className="toolbar" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div className="field">
                <label htmlFor="duties-filter-patient-patients--14">Filter patient ({patients.length})</label>
                <select id="duties-filter-patient-patients--14"
                  value={filterPatient}
                  onChange={function (event) {
                    setFilterPatient(event.target.value);
                  }}
                >
                  <option value="">All patients</option>
                  {patients.map(function (p) {
                    const label = p.name || p.full_name || p.id;
                    return (
                      <option key={p.id} value={p.id}>
                        {label} ({p.id})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="duties-filter-caretaker-employe-15">Filter caretaker ({employees.length})</label>
                <select id="duties-filter-caretaker-employe-15"
                  value={filterEmployee}
                  onChange={function (event) {
                    setFilterEmployee(event.target.value);
                  }}
                >
                  <option value="">All staff</option>
                  {employees.map(function (e) {
                    return (
                      <option key={e.id} value={e.id}>
                        {(e.full_name || e.name) + " (" + e.id + ")"}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="duties-status-16">Status</label>
                <select id="duties-status-16"
                  value={statusFilter}
                  onChange={function (event) {
                    setStatusFilter(event.target.value);
                  }}
                >
                  <option value="">All</option>
                  {DUTY_STATUSES.map(function (s) {
                    return (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="calendar-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {WEEKDAYS.map(function (w) {
                return (
                  <div key={w} className="mini-muted" style={{ textAlign: "center", fontWeight: 600 }}>
                    {w}
                  </div>
                );
              })}
              {calendarCells.map(function (isoDay, idx) {
                if (!isoDay) {
                  return <div key={"pad-" + idx} className="calendar-cell muted" />;
                }
                const dayRows = dutiesOnDay(isoDay);
                const isSelected = selectedDay === isoDay;
                return (
                  <button
                    key={isoDay}
                    type="button"
                    className={"calendar-cell" + (isSelected ? " selected" : "")}
                    style={{
                      minHeight: 72,
                      border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                      borderRadius: 6,
                      background: dayRows.length ? "#eff6ff" : "#fff",
                      padding: 6,
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                    onClick={function () {
                      setSelectedDay(isoDay);
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{isoDay.slice(8)}</div>
                    {dayRows.length ? (() => {
                      type DayChip = {
                        row: DutyListRow;
                        partner: { employee_id: string; partner: string; manual: boolean };
                      };
                      const chips: DayChip[] = [];
                      dayRows.forEach(function (row) {
                        const partners = filterPartnersForActiveCaretaker(
                          partnersForDutyDay(row, isoDay)
                        );
                        partners.forEach(function (p) {
                          chips.push({ row: row, partner: p });
                        });
                      });
                      // Dedupe chips so the same (patient, partner) pair only
                      // shows once per day even if both filters somehow overlap
                      // with extra_partners reassignments.
                      const seen: Record<string, boolean> = {};
                      const unique: DayChip[] = [];
                      chips.forEach(function (c) {
                        const k =
                          (c.row.patient_id || "") +
                          "|" +
                          c.partner.employee_id +
                          "|" +
                          (c.row.shift_type || "");
                        if (seen[k]) return;
                        seen[k] = true;
                        unique.push(c);
                      });
                      const visible = unique.slice(0, 3);
                      const rest = unique.length - visible.length;
                      return (
                        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                          {visible.map(function (c, ix) {
                            const chip = shiftChipStyle(c.row.shift_type);
                            const partnerName = c.partner.partner;
                            const patientName =
                              patientNameById[c.row.patient_id || ""] || c.row.patient_id || "";
                            // Chip text adapts to the active filter so the
                            // unique-per-day dimension is always emphasised.
                            let primary;
                            let secondary = "";
                            if (filterPatient) {
                              primary = partnerName;
                            } else if (filterEmployee) {
                              primary = patientName;
                            } else {
                              primary = patientName;
                              secondary = partnerName;
                            }
                            return (
                              <span
                                key={c.row.id + "::" + c.partner.employee_id + "::" + ix}
                                style={{
                                  fontSize: 10,
                                  lineHeight: 1.2,
                                  padding: "2px 4px",
                                  borderRadius: 4,
                                  background: chip.bg,
                                  border: "1px solid " + chip.border,
                                  color: chip.text,
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis"
                                }}
                                title={
                                  patientName +
                                  " · " +
                                  partnerName +
                                  " · " +
                                  (c.row.shift_type || "DAY") +
                                  (c.partner.manual ? " · manual override" : "")
                                }
                              >
                                {c.partner.manual ? "✎ " : ""}
                                <strong>{shortLabel(primary, "—")}</strong>
                                {secondary ? (
                                  <span style={{ opacity: 0.85 }}>
                                    {" · "}
                                    {shortLabel(secondary, "")}
                                  </span>
                                ) : null}{" "}
                                <span style={{ opacity: 0.85 }}>{c.row.shift_type}</span>
                              </span>
                            );
                          })}
                          {rest > 0 ? (
                            <span className="mini-muted" style={{ fontSize: 10 }}>
                              +{rest} more
                            </span>
                          ) : null}
                        </div>
                      );
                    })() : null}
                  </button>
                );
              })}
            </div>

            {rows.length >= DUTIES_LIMIT && rowsTotal > rows.length ? (
              <div className="info-text" role="status" style={{ marginTop: 12, background: "#fff7e6", border: "1px solid #ffd28d", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                Showing first {rows.length} of {rowsTotal} duties this month — refine filters or pick a narrower month to see them all.
              </div>
            ) : null}

            {selectedDay ? (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ marginBottom: 8 }}>Duties on {formatDate(selectedDay + "T12:00:00Z")}</h3>
                {!dayDuties.length ? (
                  <EmptyState title="No duties this day" description="Create an assignment with start/end covering this date." />
                ) : (
                  <div className="record-list">
                    {dayDuties.map(function (row) {
                      const allEntries = diaryByDuty[row.id] || [];
                      const entriesForDay = filterPartnersForActiveCaretaker(
                        allEntries.filter(function (e) { return e.date === selectedDay; })
                      );
                      // Use the same display fallback as the chips so old
                      // diary rows (with partner = employee_id) still render
                      // as the staff's real name.
                      const dayPartnerNames = entriesForDay.length
                        ? entriesForDay
                            .map(function (e) {
                              return (
                                partnerDisplayName(e.employee_id, e.partner, employeeNameById) +
                                (e.manual ? " ✎" : "")
                              );
                            })
                            .join(" + ")
                        : filterEmployee
                          ? partnerDisplayName(filterEmployee, "", employeeNameById)
                          : partnerDisplayName(row.employee_id || "", "", employeeNameById);
                      return (
                        <div className="record-card" key={row.id}>
                          <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div>
                              <h3>
                                {patientNameById[row.patient_id || ""] || row.patient_id}
                              </h3>
                              <div className="record-meta">
                                <span>{dayPartnerNames}</span>
                                <span>{row.service_name || row.service_type}</span>
                                <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                              </div>
                              <div className="mini-muted" style={{ marginTop: 6 }}>
                                Default ₹{row.charge_per_day || 0}/day charge · ₹{row.payout_per_day || 0}/day payout
                              </div>
                            </div>
                            <div className="button-row">
                              {canWrite && dutyRowPermissions(row).canEdit ? (
                                <button className="button secondary" type="button" onClick={function () { editDuty(row); }}>
                                  Edit
                                </button>
                              ) : null}
                              {canMaterialize && dutyRowPermissions(row).canMaterialize ? (
                                <button
                                  className="button secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={function () { runMaterialize(row.id, false); }}
                                >
                                  Sync diary
                                </button>
                              ) : null}
                              {canCheckIn && dutyRowPermissions(row).canCheckIn ? (
                                <button
                                  className="button success"
                                  type="button"
                                  disabled={busy}
                                  onClick={function () { runDutyAction(row.id, "check-in"); }}
                                >
                                  Check in
                                </button>
                              ) : null}
                              {canCheckIn && dutyRowPermissions(row).canCheckOut ? (
                                <button
                                  className="button success"
                                  type="button"
                                  disabled={busy}
                                  onClick={function () { runDutyAction(row.id, "check-out"); }}
                                >
                                  Check out
                                </button>
                              ) : null}
                              {canHardDelete && dutyRowPermissions(row).canHardDelete ? (
                                <button
                                  className="button danger ghost"
                                  type="button"
                                  disabled={busy}
                                  style={{ background: "transparent", color: "#b91c1c", borderColor: "#fecaca" }}
                                  onClick={function () {
                                    const endLabel = row.end_at && String(row.end_at).slice(0, 10) !== "2099-12-31"
                                      ? istDayKey(row.end_at)
                                      : "open-ended";
                                    setDeleteDialog({
                                      id: row.id,
                                      patient:
                                        patientNameById[row.patient_id || ""] ||
                                        row.patient_id ||
                                        "",
                                      employee:
                                        employeeNameById[row.employee_id || ""] ||
                                        row.employee_id ||
                                        "—",
                                      range: istDayKey(row.start_at) + " → " + endLabel
                                    });
                                  }}
                                >
                                  Delete
                                </button>
                              ) : null}
                              {canCancel && dutyRowPermissions(row).canCancel ? (
                                <button
                                  className="button danger"
                                  type="button"
                                  disabled={busy}
                                  onClick={function () {
                                    setCancelDialog({ id: row.id, reason: "" });
                                  }}
                                >
                                  Cancel
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              padding: 10,
                              borderTop: "1px dashed #e2e8f0",
                              background: "#fbfdff",
                              borderRadius: 6
                            }}
                          >
                            <div className="button-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                              <strong style={{ fontSize: 13 }}>
                                Day-wise entries · {formatDate(selectedDay + "T12:00:00Z")}
                              </strong>
                              <span className="mini-muted" style={{ fontSize: 12 }}>
                                Edits here override the duty defaults for this day only.
                              </span>
                            </div>
                            {!entriesForDay.length ? (
                              <div className="mini-muted" style={{ fontSize: 12 }}>
                                No materialized entry yet — click <em>Sync diary</em> to generate one.
                              </div>
                            ) : (
                              entriesForDay.map(function (entry) {
                                const k = diaryKey(row.id, entry.date, entry.employee_id);
                                const draft = diaryEdits[k];
                                const entryBusy = !!diaryBusy[k];
                                return (
                                  <div
                                    key={k}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "minmax(160px, 1.4fr) 110px 110px auto",
                                      gap: 8,
                                      alignItems: "center",
                                      padding: "6px 0",
                                      borderTop: "1px solid #eef2f7"
                                    }}
                                  >
                                    {draft ? (
                                      <div>
                                        <select
                                          value={draft.employee_id || entry.employee_id}
                                          onChange={function (event) {
                                            updateDayField(row.id, entry, "employee_id", event.target.value);
                                          }}
                                          style={{ width: "100%" }}
                                        >
                                          {employees.map(function (e) {
                                            return (
                                              <option key={e.id} value={e.id}>
                                                {(e.full_name || e.name) + " (" + e.id + ")"}
                                              </option>
                                            );
                                          })}
                                        </select>
                                        {draft.employee_id && draft.employee_id !== entry.employee_id ? (
                                          <div className="mini-muted" style={{ fontSize: 11, marginTop: 4, color: "#b45309" }}>
                                            Reassigning from {employeeNameById[entry.employee_id] || entry.partner || entry.employee_id} →{" "}
                                            {employeeNameById[draft.employee_id] || draft.employee_id}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                                          {(function () {
                                            const lookup = employeeNameById[entry.employee_id];
                                            if (lookup && lookup !== entry.employee_id) return lookup;
                                            if (entry.partner && entry.partner !== entry.employee_id) return entry.partner;
                                            return lookup || entry.partner || entry.employee_id;
                                          })()}
                                        </div>
                                        <div className="mini-muted" style={{ fontSize: 11 }}>
                                          {entry.manual ? "Manual override · sync will skip" : "Auto · sync may update"}
                                        </div>
                                      </div>
                                    )}
                                    {draft ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={draft.charge}
                                        placeholder="Charge"
                                        onChange={function (event) {
                                          updateDayField(row.id, entry, "charge", event.target.value);
                                        }}
                                      />
                                    ) : (
                                      <div style={{ fontSize: 13 }}>
                                        <span className="mini-muted">Charge </span>
                                        ₹{Number(entry.charge || 0).toLocaleString("en-IN")}
                                      </div>
                                    )}
                                    {draft ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={draft.payout}
                                        placeholder="Payout"
                                        onChange={function (event) {
                                          updateDayField(row.id, entry, "payout", event.target.value);
                                        }}
                                      />
                                    ) : (
                                      <div style={{ fontSize: 13 }}>
                                        <span className="mini-muted">Payout </span>
                                        ₹{Number(entry.payout || 0).toLocaleString("en-IN")}
                                      </div>
                                    )}
                                    {canDiaryEdit ? (
                                      <div className="button-row">
                                        {draft ? (
                                          <>
                                            <button
                                              className="button primary"
                                              type="button"
                                              disabled={entryBusy}
                                              onClick={function () { saveDayEdit(row.id, entry); }}
                                            >
                                              Save
                                            </button>
                                            <button
                                              className="button secondary"
                                              type="button"
                                              disabled={entryBusy}
                                              onClick={function () { cancelEditDay(row.id, entry); }}
                                            >
                                              Cancel
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              className="button secondary"
                                              type="button"
                                              disabled={entryBusy}
                                              onClick={function () { startEditDay(row.id, entry); }}
                                            >
                                              Edit
                                            </button>
                                            {entry.manual ? (
                                              <button
                                                className="button secondary"
                                                type="button"
                                                disabled={entryBusy}
                                                title="Drop the manual lock and let the next sync recompute this day"
                                                onClick={function () { clearDayManual(row.id, entry); }}
                                              >
                                                Unlock
                                              </button>
                                            ) : null}
                                            <button
                                              className="button danger ghost"
                                              type="button"
                                              disabled={entryBusy}
                                              style={{ background: "transparent", color: "#b91c1c", borderColor: "#fecaca" }}
                                              onClick={function () { deleteDay(row.id, entry); }}
                                            >
                                              Delete
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : loading ? (
              <div className="mini-muted" style={{ marginTop: 16 }} role="status" aria-live="polite">
                Loading…
              </div>
            ) : null}
          </ModuleShell>
        </div>

        {previewDialog && previewDialog.data ? (
          <ModalDialog
            open
            onClose={function () { setPreviewDialog(null); }}
            lockClose={busy}
            className="modal-card"
            title="Sync diary preview"
            style={{ maxWidth: 720, width: "95%" }}
          >
              <p className="mini-muted">
                Create {previewDialog.data.would_create_svc || 0} / update{" "}
                {previewDialog.data.would_update_svc || 0} patient charge(s) · create{" "}
                {previewDialog.data.would_create_payout || 0} / update{" "}
                {previewDialog.data.would_update_payout || 0} payout(s) · delete{" "}
                {(previewDialog.data.would_delete_svc || 0) +
                  (previewDialog.data.would_delete_payout || 0)}{" "}
                orphan row(s).
              </p>
              <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto", marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Partner</th>
                      <th>Charge</th>
                      <th>Payout</th>
                      <th>Patient svc</th>
                      <th>Partner pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewDialog.data.preview || []).slice(0, 60).map(function (line, idx) {
                      return (
                        <tr key={idx}>
                          <td>{line.date}</td>
                          <td>{line.employee_name}</td>
                          <td>{formatCurrency(line.charge)}</td>
                          <td>{formatCurrency(line.payout)}</td>
                          <td>{line.svc_action}</td>
                          <td>{line.payout_action}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(previewDialog.data.preview || []).length > 60 ? (
                <p className="mini-muted">Showing first 60 of {(previewDialog.data.preview || []).length} rows.</p>
              ) : null}
              <div className="button-row" style={{ marginTop: 16 }}>
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={function () { runMaterialize(previewDialog.dutyId, true); }}
                >
                  Confirm sync
                </button>
                <button className="button secondary" type="button" onClick={function () { setPreviewDialog(null); }}>
                  Cancel
                </button>
              </div>
          </ModalDialog>
        ) : null}

        {overlapDialog ? (
          <ModalDialog
            open
            onClose={function () { setOverlapDialog(null); }}
            lockClose={busy}
            className="modal-card"
            title={
              overlapDialog.kind === "patient"
                ? "Patient has overlapping duty"
                : "Staff has overlapping duty"
            }
          >
              <p>{overlapDialog.message}</p>
              <p className="mini-muted">
                {overlapDialog.kind === "patient"
                  ? "Two carers on the same patient is legitimate for relief / partner-share shifts. Confirm to add anyway — both partners will accrue per-day charges + payouts."
                  : "Legacy CRM allowed the same staff to be on relief / shared shifts. Confirm to save anyway."}
              </p>
              <div className="button-row">
                <button className="button primary" type="button" disabled={busy} onClick={confirmOverlapAndSave}>
                  Save anyway
                </button>
                <button className="button secondary" type="button" onClick={function () { setOverlapDialog(null); }}>
                  Back
                </button>
              </div>
          </ModalDialog>
        ) : null}

        {cancelDialog ? (
          <ModalDialog
            open
            onClose={function () { setCancelDialog(null); }}
            onRequestClose={function () {
              if (cancelDialog.reason.trim()) {
                void confirm({
                  title: "Discard reason?",
                  description: "Closing will lose the cancel reason you typed.",
                  confirmLabel: "Discard",
                  tone: "danger"
                }).then(function (ok) {
                  if (ok) setCancelDialog(null);
                });
                return;
              }
              setCancelDialog(null);
            }}
            lockClose={busy}
            className="modal-card"
            title="Cancel duty"
          >
              <div className="field">
                <label htmlFor="duties-reason-optional-17">Reason (optional)</label>
                <input id="duties-reason-optional-17"
                  value={cancelDialog.reason}
                  onChange={function (event) {
                    setCancelDialog({ ...cancelDialog, reason: event.target.value });
                  }}
                />
              </div>
              <div className="button-row">
                <button className="button danger" type="button" disabled={busy} onClick={confirmCancel}>
                  Confirm cancel
                </button>
                <button className="button secondary" type="button" onClick={function () { setCancelDialog(null); }}>
                  Back
                </button>
              </div>
          </ModalDialog>
        ) : null}

        {deleteDialog ? (
          <ModalDialog
            open
            onClose={function () { setDeleteDialog(null); }}
            lockClose={busy}
            className="modal-card"
            title="Delete duty permanently?"
          >
              <p>
                <strong>{deleteDialog.patient}</strong> · {deleteDialog.employee}
              </p>
              <p className="mini-muted">{deleteDialog.range}</p>
              <p className="mini-muted">
                This removes the duty row <strong>and all of its diary charges &amp; payouts</strong>.
                Will fail if receipts already exist on the bill (cancel instead).
              </p>
              <div className="button-row">
                <button className="button danger" type="button" disabled={busy} onClick={confirmHardDelete}>
                  Delete forever
                </button>
                <button className="button secondary" type="button" onClick={function () { setDeleteDialog(null); }}>
                  Back
                </button>
              </div>
          </ModalDialog>
        ) : null}
      </AppShell>
    </AuthGuard>
  );
}
