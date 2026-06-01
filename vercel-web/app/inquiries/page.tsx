"use client";

/**
 * Inquiries / lead management page (M4 Pass D — TypeScript).
 *
 * Presentation-only: all writes go through `/api/v1/inquiries/*`. Shared
 * overdue/status rules live in `@/business/inquiryRules`; PDF/WhatsApp
 * helpers in `@/lib/inquiryUi`.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { usePaginatedResource } from "@/hooks/use-paginated-resource";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import {
  inquiryPotentialOptions,
  inquirySourceOptions,
  inquiryStatusOptions
} from "@/lib/crm-options";
import { formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";
import {
  buildInquiryPdfBody,
  buildInquiryWhatsAppUrl,
  inquiryDisplayName,
  inquiryListPosition,
  type InquiryListRow
} from "@/lib/inquiryUi";
import {
  INQUIRY_OPEN_STATUSES,
  INQUIRY_CLOSED_STATUSES,
  type InquiryStatus
} from "@/validation/inquiryValidation";
import { isOverdueFollowup as inquiryIsOverdueFollowup } from "@/business/inquiryRules";

const OPEN_STATUSES = INQUIRY_OPEN_STATUSES;

function inquiryRowPermissions(row) {
  return (
    (row && row.permissions) || {
      canEdit: false,
      canConvert: false,
      canClose: false,
      canReopen: false,
      canDelete: false,
      canHardDelete: false
    }
  );
}
const CLOSED_STATUSES = INQUIRY_CLOSED_STATUSES;

interface InquiryFormState {
  id: string;
  patient_name: string;
  mobile: string;
  area: string;
  city: string;
  service_required: string;
  source: string;
  potential: string;
  /** Create form only — edits use the status dialog. */
  status: string;
  assigned_to: string;
  followup_date: string;
  emergency_level: number | string | null;
  flexibility_score: number | string | null;
  priority_score: number | string | null;
  rating_touched: {
    emergency_level: boolean;
    flexibility_score: boolean;
    priority_score: boolean;
  };
  expected_updated_at: string;
  confirm_existing_patient: boolean;
  notes: string;
}

interface StatusDialogState {
  id: string;
  name: string;
  nextStatus: InquiryStatus;
  reason: string;
  followup_date: string;
  requiresReason: boolean;
}

interface DeleteDialogState {
  id: string;
  name: string;
  reason: string;
  hard: boolean;
}

interface ConvertDialogState {
  id: string;
  name: string;
  notes: string;
}

interface EmployeeOption {
  id: string;
  full_name?: string;
  name?: string;
}

function createInitialForm(): InquiryFormState {
  return {
    id: "",
    patient_name: "",
    mobile: "",
    area: "",
    city: "Ahmedabad",
    service_required: "",
    source: "WHATSAPP",
    potential: "WARM",
    status: "New",
    assigned_to: "",
    followup_date: "",
    emergency_level: null,
    flexibility_score: null,
    priority_score: null,
    rating_touched: {
      emergency_level: false,
      flexibility_score: false,
      priority_score: false
    },
    expected_updated_at: "",
    confirm_existing_patient: false,
    notes: ""
  };
}

/** Local adapter — forwards API row primitives to the shared business rule. */
function isOverdueFollowup(row: InquiryListRow): boolean {
  return inquiryIsOverdueFollowup(row.followup_date, row.status);
}

export default function InquiriesPage() {
  const auth = useAuth() as unknown as {
    session?: { access_token?: string } | null;
    profile?: { role?: string } | null;
  };
  const isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(true);

  useEffect(
    function () {
      var handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  // M4-L1: depend on the access token string instead of the session object
  // identity. Supabase mints a new session object on every onAuthStateChange
  // fire even when the token is unchanged, which would re-fire this effect
  // unnecessarily and risk a stale-response race.
  var accessToken = auth.session?.access_token || "";
  useEffect(
    function () {
      if (!accessToken) {
        setEmployees([]);
        setEmployeesError("");
        return undefined;
      }
      var cancelled = false;
      setEmployeesError("");
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          if (cancelled) return;
          setEmployees(Array.isArray(rows) ? rows : rows?.rows || rows?.data || []);
        })
        .catch(function (lookupError) {
          if (cancelled) return;
          setEmployees([]);
          // M4-M5: surface the underlying error so operators know the
          // dropdown is empty because the lookup failed, not because the
          // employees table is empty. Swallowing this caused field reports
          // of "I can't assign inquiries".
          setEmployeesError(
            (lookupError && lookupError.message)
              ? "Could not load employees: " + lookupError.message
              : "Could not load employees"
          );
        });
      return function () { cancelled = true; };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accessToken is
    // the real identity of auth.session for this fetch; depending on
    // auth.session directly would defeat the point of this fix.
    [accessToken]
  );

  const listQuery = useMemo(
    function () {
      return {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        source: sourceFilter || undefined,
        open_only: openOnly ? "true" : undefined
      };
    },
    [debouncedSearch, statusFilter, sourceFilter, openOnly]
  );

  const resource = usePaginatedResource({
    basePath: "/inquiries",
    table: "hh_inquiries",
    channel: "inquiries",
    queryParams: listQuery,
    resetKey: debouncedSearch + "|" + statusFilter + "|" + sourceFilter + "|" + (openOnly ? "1" : "0"),
    pageSize: 50
  });
  const [form, setForm] = useState<InquiryFormState>(createInitialForm);
  const [formPermissions, setFormPermissions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
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

  const [statusDialog, setStatusDialog] = useState<StatusDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [convertDialog, setConvertDialog] = useState<ConvertDialogState | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{
    actual?: string;
    message: string;
  } | null>(null);
  const [duplicatePatientPrompt, setDuplicatePatientPrompt] = useState<{
    message: string;
  } | null>(null);

  const filtered = useMemo((): InquiryListRow[] => {
    const rows = (resource.data || []) as InquiryListRow[];
    if (!potentialFilter) return rows;
    return rows.filter((row) => row.potential === potentialFilter);
  }, [resource.data, potentialFilter]);

  const overdueCount = useMemo(
    function () {
      return filtered.filter(function (row) { return isOverdueFollowup(row); }).length;
    },
    [filtered]
  );

  function errorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    return fallback;
  }

  function updateField<K extends keyof InquiryFormState>(
    name: K,
    value: InquiryFormState[K]
  ) {
    setForm(function (current) {
      const next = { ...current, [name]: value };
      if (name === "emergency_level" || name === "flexibility_score" || name === "priority_score") {
        next.rating_touched = { ...current.rating_touched, [name]: true };
      }
      return next;
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setFormPermissions(null);
    setError("");
    setMessage("");
    setConflictPrompt(null);
    setDuplicatePatientPrompt(null);
  }

  function editInquiry(row: InquiryListRow) {
    setForm({
      id: row.id,
      patient_name: row.patient_name || row.name || "",
      mobile: row.mobile || row.phone || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      service_required: row.service_required || row.service || "",
      source: row.source || "WHATSAPP",
      potential: row.potential || "WARM",
      status: row.status || "New",
      assigned_to: row.assigned_to || "",
      followup_date: row.followup_date || "",
      emergency_level: row.emergency_level ?? row.rating_emergency ?? null,
      flexibility_score: row.flexibility_score ?? row.rating_flexibility ?? null,
      priority_score: row.priority_score ?? row.rating_overall ?? null,
      rating_touched: {
        emergency_level: row.emergency_level != null || row.rating_emergency != null,
        flexibility_score: row.flexibility_score != null || row.rating_flexibility != null,
        priority_score: row.priority_score != null || row.rating_overall != null
      },
      expected_updated_at: row.updated_at || "",
      confirm_existing_patient: false,
      notes: row.notes || row.remarks || ""
    });
    setFormPermissions(inquiryRowPermissions(row));
    setError("");
    // M4-M4: legacy rows can lack `updated_at` (the column was added later).
    // Without it, optimistic-concurrency control silently degrades to "last
    // write wins" — a concurrent edit elsewhere will be clobbered without
    // the conflict dialog firing. Surface that to the operator so they
    // know to be careful and reach out for a manual reconciliation if
    // needed. The save itself is still allowed (the legacy SPA cannot fix
    // these rows retroactively from the UI).
    if (!row.updated_at) {
      setMessage(
        "Loaded a legacy inquiry without a last-modified timestamp — concurrent edit detection is disabled for this record. Save with care."
      );
    } else {
      setMessage("");
    }
  }

  // Internal — accepts an optional `formOverride` so the duplicate-patient
  // "Save anyway" branch can pass an updated form snapshot synchronously
  // (M4-M3). The previous flow relied on React state to flip
  // `confirm_existing_patient` and then asked the user to click Save again.
  async function submitForm(formOverride?: InquiryFormState) {
    const current = formOverride || form;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        patient_name: current.patient_name,
        mobile: current.mobile,
        area: current.area,
        city: current.city,
        service_required: current.service_required,
        source: current.source,
        potential: current.potential,
        status: current.status,
        assigned_to: current.assigned_to || "",
        followup_date: current.followup_date || "",
        notes: current.notes
      };
      const touched = current.rating_touched || {};
      if (touched.emergency_level && current.emergency_level != null) {
        payload.emergency_level = Number(current.emergency_level);
      }
      if (touched.flexibility_score && current.flexibility_score != null) {
        payload.flexibility_score = Number(current.flexibility_score);
      }
      if (touched.priority_score && current.priority_score != null) {
        payload.priority_score = Number(current.priority_score);
      }
      if (current.id && current.expected_updated_at) {
        payload.expected_updated_at = current.expected_updated_at;
      }
      if (current.confirm_existing_patient) {
        payload.confirm_existing_patient = true;
      }
      await requestWithOfflineFallback(
        current.id ? "/inquiries/" + current.id : "/inquiries",
        { method: current.id ? "PUT" : "POST", body: payload },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(current.id ? "Inquiry updated" : "Inquiry created");
    } catch (submitError: unknown) {
      const err = submitError as {
        code?: string;
        message?: string;
        details?: { actual_updated_at?: string; field?: string };
      };
      const code = err?.code;
      if (code === "conflict") {
        setConflictPrompt({
          actual: err?.details?.actual_updated_at,
          message: err.message || "Inquiry was modified by another user."
        });
      } else if (
        code === "duplicate" &&
        err?.details?.field === "phone_existing_patient" &&
        !current.id
      ) {
        setDuplicatePatientPrompt({
          message: err.message || "This phone is already a registered patient."
        });
      } else {
        setError(errorMessage(submitError, "Unable to save inquiry"));
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    return submitForm();
  }

  async function reloadInquiryFromConflict() {
    if (!form.id) {
      setConflictPrompt(null);
      return;
    }
    setBusy(true);
    try {
      var fresh = await request("/inquiries/" + form.id, null, auth.session);
      editInquiry(fresh);
      setConflictPrompt(null);
      setMessage("Inquiry reloaded — your previous edits were discarded.");
    } catch (reloadError: unknown) {
      setError(errorMessage(reloadError, "Could not reload inquiry."));
    } finally {
      setBusy(false);
    }
  }

  // M4-M3: previously this only mutated state and asked the user to click
  // Save a second time. Build the next form snapshot synchronously, push
  // it into React state (so the form stays in sync), and re-submit using
  // the override path on submitForm so we don't wait for a re-render.
  async function confirmExistingPatientAndResubmit() {
    setDuplicatePatientPrompt(null);
    var next = { ...form, confirm_existing_patient: true };
    setForm(next);
    await submitForm(next);
  }

  function openStatusDialog(row: InquiryListRow, nextStatus: InquiryStatus) {
    const rowStatus = (row.status || "New") as InquiryStatus;
    const reopening =
      (rowStatus === "Closed" || rowStatus === "Lost") &&
      (OPEN_STATUSES as readonly string[]).includes(nextStatus);
    setStatusDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      nextStatus: nextStatus,
      reason: "",
      followup_date: row.followup_date || new Date().toISOString().slice(0, 10),
      requiresReason:
        nextStatus === "Closed" || nextStatus === "Lost" || reopening
    });
  }

  async function submitStatusDialog() {
    if (!statusDialog) return;
    if (
      (statusDialog.nextStatus === "FollowUp" || statusDialog.nextStatus === "Negotiating") &&
      !statusDialog.followup_date
    ) {
      setError("Follow-up date is required for this status");
      return;
    }
    if (statusDialog.requiresReason && !statusDialog.reason.trim()) {
      setError("Please provide a reason");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/inquiries/" + statusDialog.id + "/status",
        {
          method: "POST",
          body: {
            status: statusDialog.nextStatus,
            reason: statusDialog.reason.trim(),
            followup_date: statusDialog.followup_date || ""
          }
        },
        auth.session
      );
      setMessage("Inquiry → " + statusDialog.nextStatus);
      setStatusDialog(null);
      await resource.reload();
      if (form.id === statusDialog.id) resetForm();
    } catch (statusError: unknown) {
      setError(errorMessage(statusError, "Unable to change status"));
    } finally {
      setBusy(false);
    }
  }

  function openDeleteDialog(row: InquiryListRow) {
    setDeleteDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      reason: "",
      hard: false
    });
  }

  async function submitDeleteDialog() {
    if (!deleteDialog) return;
    setBusy(true);
    setError("");
    try {
      var path = "/inquiries/" + deleteDialog.id;
      if (deleteDialog.hard) path += "?hard=1";
      var result = await requestWithOfflineFallback(
        path,
        { method: "DELETE", body: { reason: deleteDialog.reason.trim() } },
        auth.session
      );
      await resource.reload();
      if (form.id === deleteDialog.id) resetForm();
      setMessage(
        result && result.mode === "hard"
          ? "Inquiry permanently deleted"
          : "Inquiry closed (history preserved)"
      );
      setDeleteDialog(null);
    } catch (deleteError: unknown) {
      setError(errorMessage(deleteError, "Unable to delete inquiry"));
    } finally {
      setBusy(false);
    }
  }

  function openConvertDialog(row: InquiryListRow) {
    setConvertDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      notes: row.notes || row.remarks || ""
    });
  }

  async function submitConvertDialog() {
    if (!convertDialog) return;
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/inquiries/" + convertDialog.id + "/convert",
        { method: "POST", body: { notes: convertDialog.notes } },
        auth.session
      );
      setMessage(
        data?.alreadyConverted
          ? "Already converted — patient " + (data.patient_id || "")
          : "Converted to patient " + (data?.patient_id || "OK")
      );
      setConvertDialog(null);
      await resource.reload();
    } catch (convertError: unknown) {
      setError(errorMessage(convertError, "Unable to convert inquiry"));
    } finally {
      setBusy(false);
    }
  }

  function openInquiryPdf(row: InquiryListRow, hideMobile: boolean) {
    openPrintWindow(
      hideMobile ? "Inquiry PDF (without mobile)" : "Inquiry PDF",
      buildInquiryPdfBody(row, hideMobile)
    );
  }

  function sendWhatsApp(row: InquiryListRow) {
    window.open(buildInquiryWhatsAppUrl(row), "_blank");
  }

  return (
    <AuthGuard permission="inquiries.read">
      <AppShell title="Inquiries">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit Inquiry" : "Create Inquiry"}
            description="Capture leads with status workflow, follow-ups and convert-to-patient."
            actions={undefined}
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="inquiries-patient-name-1">Patient Name</label>
                  <input id="inquiries-patient-name-1" value={form.patient_name} onChange={function (event) { updateField("patient_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="inquiries-mobile-2">Mobile</label>
                  <input id="inquiries-mobile-2" type="tel" inputMode="tel" value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="inquiries-area-3">Area</label>
                  <input id="inquiries-area-3" value={form.area} onChange={function (event) { updateField("area", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="inquiries-city-4">City</label>
                  <input id="inquiries-city-4" value={form.city} onChange={function (event) { updateField("city", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="inquiries-service-required-5">Service Required</label>
                  <input id="inquiries-service-required-5" value={form.service_required} onChange={function (event) { updateField("service_required", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="inquiries-source-6">Source</label>
                  <select id="inquiries-source-6" value={form.source} onChange={function (event) { updateField("source", event.target.value); }}>
                    {inquirySourceOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="inquiries-potential-7">Potential</label>
                  <select id="inquiries-potential-7" value={form.potential} onChange={function (event) { updateField("potential", event.target.value); }}>
                    {inquiryPotentialOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="inquiries-status-8">Status</label>
                  <select
                    id="inquiries-status-8"
                    value={form.status}
                    onChange={function (event) { updateField("status", event.target.value); }}
                    disabled={Boolean(form.id)}
                    title={form.id ? "Use the Change Status button below to move this inquiry through its lifecycle." : undefined}
                  >
                    {inquiryStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                  {form.id ? (
                    <small className="mini-muted" style={{ marginTop: 4, display: "block" }}>
                      Status changes go through the Change Status action — pick a target status from the inquiry card on the right (Mark Contacted, Follow-up, Negotiating, Lost, Reopen).
                    </small>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="inquiries-assigned-to-9">Assigned to</label>
                  <select id="inquiries-assigned-to-9" value={form.assigned_to} onChange={function (event) { updateField("assigned_to", event.target.value); }}>
                    <option value="">Unassigned</option>
                    {employees.map(function (emp) {
                      var label = emp.full_name || emp.name || emp.id;
                      return <option key={emp.id} value={emp.id}>{label}</option>;
                    })}
                  </select>
                  {employeesError ? (
                    <small className="error-text" style={{ marginTop: 4, display: "block" }}>
                      {employeesError}
                    </small>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="inquiries-follow-up-date-10">Follow-up date</label>
                  <input id="inquiries-follow-up-date-10"
                    type="date"
                    value={form.followup_date}
                    onChange={function (event) { updateField("followup_date", event.target.value); }}
                    required={form.status === "FollowUp" || form.status === "Negotiating"}
                  />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="inquiries-emergency-level-1-10-11">Emergency Level (1-10)</label>
                  <input id="inquiries-emergency-level-1-10-11"
                    type="range"
                    min="1"
                    max="10"
                    value={form.emergency_level != null ? form.emergency_level : 5}
                    onChange={function (event) { updateField("emergency_level", Number(event.target.value)); }}
                  />
                  <small>{form.emergency_level != null ? form.emergency_level : "Not rated"}/10</small>
                </div>
                <div className="field">
                  <label htmlFor="inquiries-flexibility-1-10-12">Flexibility (1-10)</label>
                  <input id="inquiries-flexibility-1-10-12"
                    type="range"
                    min="1"
                    max="10"
                    value={form.flexibility_score != null ? form.flexibility_score : 5}
                    onChange={function (event) { updateField("flexibility_score", Number(event.target.value)); }}
                  />
                  <small>{form.flexibility_score != null ? form.flexibility_score : "Not rated"}/10</small>
                </div>
                <div className="field">
                  <label htmlFor="inquiries-priority-1-10-13">Priority (1-10)</label>
                  <input id="inquiries-priority-1-10-13"
                    type="range"
                    min="1"
                    max="10"
                    value={form.priority_score != null ? form.priority_score : 5}
                    onChange={function (event) { updateField("priority_score", Number(event.target.value)); }}
                  />
                  <small>{form.priority_score != null ? form.priority_score : "Not rated"}/10</small>
                </div>
              </div>
              <div className="field">
                <label htmlFor="inquiries-notes-14">Notes</label>
                <textarea id="inquiries-notes-14" rows={3} value={form.notes} onChange={function (event) { updateField("notes", event.target.value); }} />
              </div>
              {conflictPrompt ? (
                <div className="error-text" role="alert" aria-live="assertive" style={{ border: "1px solid var(--warn, #d97706)", background: "rgba(217,119,6,0.08)", padding: "10px 12px", borderRadius: 6 }}>
                  <div style={{ marginBottom: 6 }}>
                    <strong>Concurrent edit detected.</strong> {conflictPrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button className="button primary" type="button" onClick={reloadInquiryFromConflict} disabled={busy}>Reload latest</button>
                    <button className="button ghost" type="button" onClick={function () { setConflictPrompt(null); }} disabled={busy}>Dismiss</button>
                  </div>
                </div>
              ) : null}
              {duplicatePatientPrompt ? (
                <div className="error-text" role="alert" aria-live="assertive" style={{ border: "1px solid var(--warn, #d97706)", background: "rgba(217,119,6,0.08)", padding: "10px 12px", borderRadius: 6 }}>
                  <div style={{ marginBottom: 6 }}>
                    <strong>Existing patient.</strong> {duplicatePatientPrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button className="button primary" type="button" onClick={confirmExistingPatientAndResubmit} disabled={busy}>Save inquiry anyway</button>
                    <button className="button ghost" type="button" onClick={function () { setDuplicatePatientPrompt(null); }} disabled={busy}>Cancel</button>
                  </div>
                </div>
              ) : null}
              <ErrorBanner
                message={
                  error && !conflictPrompt && !duplicatePatientPrompt
                    ? error
                    : !error && !conflictPrompt && !duplicatePatientPrompt && resource.error
                      ? `Live inquiry list error — ${resource.error}`
                      : ""
                }
              />
              <SuccessBanner message={message} />
              <div className="button-row">
                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    busy ||
                    (form.id && formPermissions && !formPermissions.canEdit)
                  }
                  title={
                    formPermissions && formPermissions.blockReasons
                      ? formPermissions.blockReasons.canEdit
                      : undefined
                  }
                >
                  {busy ? "Saving..." : form.id ? "Update Inquiry" : "Create Inquiry"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell
            title="Inquiry Tracker"
            description="Status workflow, conversion to patient, follow-ups, WhatsApp & PDF."
            actions={undefined}
          >
            <div className="toolbar">
              <div className="field">
                <label htmlFor="inquiries-search-15">Search</label>
                <input id="inquiries-search-15" value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Name, mobile, service or source" />
              </div>
              <div className="field">
                <label htmlFor="inquiries-status-16">Status</label>
                <select id="inquiries-status-16" value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquiryStatusOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="inquiries-potential-17">Potential</label>
                <select id="inquiries-potential-17" value={potentialFilter} onChange={function (event) { setPotentialFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquiryPotentialOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="inquiries-source-18">Source</label>
                <select id="inquiries-source-18" value={sourceFilter} onChange={function (event) { setSourceFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquirySourceOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="inquiries-input-type-checkbox-chec-19">
                  <input id="inquiries-input-type-checkbox-chec-19" type="checkbox" checked={openOnly} onChange={function (event) { setOpenOnly(event.target.checked); }} />
                  &nbsp;Open only
                </label>
              </div>
            </div>
            <PaginationBar
              page={resource.page}
              pageSize={resource.pageSize}
              total={resource.total}
              onPageChange={resource.setPage}
              onPageSizeChange={resource.setPageSize}
              pageSizeOptions={undefined}
            />
            <div className="mini-muted" style={{ margin: "0.25rem 0 0.75rem" }}>
              {debouncedSearch ? "Search: \"" + debouncedSearch + "\" — " : ""}
              {resource.total} inquir{resource.total === 1 ? "y" : "ies"} total
              {overdueCount ? " · " + overdueCount + " overdue on this page" : ""}
              {potentialFilter ? " · potential filter applies to this page only" : ""}
              {resource.loading ? " (loading...)" : ""}
            </div>
            {!filtered.length ? (
              <EmptyState
                title={resource.loading ? "Loading inquiries..." : "No matching inquiries"}
                description={
                  debouncedSearch
                    ? "No inquiry matches \"" + debouncedSearch + "\"."
                    : "All new leads, telecalling callbacks, and hot admissions will appear here."
                }
              />
            ) : (
              <div className="record-list">
                {filtered.map(function (row, index) {
                  const status = row.status || "New";
                  const perms = inquiryRowPermissions(row);
                  const overdue = isOverdueFollowup(row);
                  const listPosition = inquiryListPosition(
                    resource.page,
                    resource.pageSize,
                    index
                  );
                  return (
                    <div className="record-card" key={row.id}>
                      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <h3>
                            <span className="row-number">#{listPosition}</span>
                            {inquiryDisplayName(row)}
                            {overdue ? <span className="status" style={{ marginLeft: 8, background: "var(--danger)" }}>Overdue</span> : null}
                          </h3>
                          <div className="record-meta">
                            <span>{row.mobile || row.phone}</span>
                            <span>{row.area || ""}, {row.city || ""}</span>
                            <span>{row.service_required || row.service || ""}</span>
                            <span className={"status " + String(status).toLowerCase()}>{status}</span>
                          </div>
                        </div>
                        <span className={"status " + String(row.potential || "").toLowerCase()}>{row.potential}</span>
                      </div>
                      <div className="helper-box" style={{ marginTop: 12 }}>
                        Emergency {row.emergency_level ?? row.rating_emergency ?? "-"}/10 ·
                        Flexibility {row.flexibility_score ?? row.rating_flexibility ?? "-"}/10 ·
                        Priority {row.priority_score ?? row.rating_overall ?? "-"}/10
                        {row.followup_date ? " · Follow-up " + row.followup_date : ""}
                      </div>
                      <div className="record-meta" style={{ marginTop: 12 }}>
                        <span>{row.source}</span>
                        <span>{formatDate(row.created_at)}</span>
                      </div>
                      <div className="button-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                        {perms.canEdit ? (
                          <button className="button secondary" type="button" onClick={function () { editInquiry(row); }}>
                            Edit
                          </button>
                        ) : null}
                        {perms.canConvert ? (
                          <button className="button success" type="button" onClick={function () { openConvertDialog(row); }} disabled={busy}>
                            Convert to patient
                          </button>
                        ) : null}
                        {perms.canEdit && status !== "Contacted" ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "Contacted"); }} disabled={busy}>
                            Mark Contacted
                          </button>
                        ) : null}
                        {perms.canEdit && status !== "FollowUp" ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "FollowUp"); }} disabled={busy}>
                            Follow-up
                          </button>
                        ) : null}
                        {perms.canEdit && status !== "Negotiating" ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "Negotiating"); }} disabled={busy}>
                            Negotiating
                          </button>
                        ) : null}
                        {perms.canClose ? (
                          <button className="button danger" type="button" onClick={function () { openStatusDialog(row, "Lost"); }} disabled={busy}>
                            Lost
                          </button>
                        ) : null}
                        {perms.canReopen ? (
                          <button className="button primary" type="button" onClick={function () { openStatusDialog(row, "New"); }} disabled={busy}>
                            Reopen
                          </button>
                        ) : null}
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, false); }}>
                          PDF
                        </button>
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, true); }}>
                          PDF (no mobile)
                        </button>
                        <button className="button success" type="button" onClick={function () { sendWhatsApp(row); }}>
                          WhatsApp
                        </button>
                        <button className="button danger" type="button" onClick={function () { openDeleteDialog(row); }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ModuleShell>
        </div>
      </AppShell>

      {statusDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setStatusDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Change status → {statusDialog.nextStatus}</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">{statusDialog.name} — recorded in the audit log.</p>
            {statusDialog.nextStatus === "FollowUp" || statusDialog.nextStatus === "Negotiating" ? (
              <div className="field">
                <label htmlFor="inquiries-follow-up-date-20">Follow-up date</label>
                <input id="inquiries-follow-up-date-20"
                  type="date"
                  value={statusDialog.followup_date}
                  onChange={function (e) {
                    var v = e.target.value;
                    setStatusDialog(function (c) { return c ? { ...c, followup_date: v } : c; });
                  }}
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="inquiries-reason-21">
                Reason
                {statusDialog.nextStatus === "Closed" || statusDialog.nextStatus === "Lost" || statusDialog.nextStatus === "New"
                  ? " (required to reopen/close)"
                  : " (optional)"}
              </label>
              <textarea id="inquiries-reason-21"
                rows={3}
                value={statusDialog.reason}
                onChange={function (e) {
                  var v = e.target.value;
                  setStatusDialog(function (c) { return c ? { ...c, reason: v } : c; });
                }}
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>Cancel</button>
              <button className="button primary" type="button" disabled={busy} onClick={submitStatusDialog}>
                {busy ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setDeleteDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Delete / close inquiry</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              By default the inquiry is closed (status Closed) so lead-source analytics are preserved.
              {isAdmin ? " Admins can permanently delete." : ""}
            </p>
            <div className="field">
              <label htmlFor="inquiries-reason-optional-22">Reason (optional)</label>
              <textarea id="inquiries-reason-optional-22"
                rows={3}
                value={deleteDialog.reason}
                onChange={function (e) {
                  var v = e.target.value;
                  setDeleteDialog(function (c) { return c ? { ...c, reason: v } : c; });
                }}
              />
            </div>
            {isAdmin ? (
              <div className="field">
                <label htmlFor="inquiries-input-23">
                  <input id="inquiries-input-23"
                    type="checkbox"
                    checked={deleteDialog.hard}
                    onChange={function (e) {
                      var v = e.target.checked;
                      setDeleteDialog(function (c) { return c ? { ...c, hard: v } : c; });
                    }}
                  />
                  &nbsp;Permanently delete (cannot undo)
                </label>
              </div>
            ) : null}
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>Cancel</button>
              <button className="button danger" type="button" disabled={busy} onClick={submitDeleteDialog}>
                {busy ? "Working..." : deleteDialog.hard ? "Delete permanently" : "Close inquiry"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {convertDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setConvertDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Convert to patient</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setConvertDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              {convertDialog.name} — creates or links a patient by mobile via the server RPC.
            </p>
            <div className="field">
              <label htmlFor="inquiries-conversion-notes-optiona-24">Conversion notes (optional)</label>
              <textarea id="inquiries-conversion-notes-optiona-24"
                rows={3}
                value={convertDialog.notes}
                onChange={function (e) {
                  var v = e.target.value;
                  setConvertDialog(function (c) { return c ? { ...c, notes: v } : c; });
                }}
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setConvertDialog(null); }}>Cancel</button>
              <button className="button success" type="button" disabled={busy} onClick={submitConvertDialog}>
                {busy ? "Converting..." : "Confirm convert"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AuthGuard>
  );
}
