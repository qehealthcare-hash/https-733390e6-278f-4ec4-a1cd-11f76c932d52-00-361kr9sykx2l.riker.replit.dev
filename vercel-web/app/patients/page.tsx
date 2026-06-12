"use client";

/**
 * Patients / client registry (M5 Pass D — TypeScript).
 *
 * Presentation-only: all writes go through `/api/v1/patients/*`. PDF helpers
 * live in `@/lib/patientUi`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { confirmDiscardTyped } from "@/lib/modalDiscard";
import { usePaginatedResource } from "@/hooks/use-paginated-resource";
import { useBusyGuard } from "@/hooks/use-busy-guard";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { useAuth } from "@/components/providers/auth-provider";
import { patientsClient, lookupsClient } from "@/lib/clients";
import {
  patientCloseReasonOptions,
  patientStatusOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatDate, slugToText } from "@/lib/formatters";
import { crmTodayIso } from "@/src/utils/crmToday";
import { patientStartDateMax } from "@/lib/dateFieldBounds";
import { downloadCsv } from "@/lib/csv";
import { openPrintWindow, preOpenPrintWindow, reportPrintBlocked } from "@/lib/print";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import { CameraCaptureModal } from "@/components/ui/camera-capture-lazy";
import { DocumentCard, DocumentList } from "@/components/ui/document-card";
import { hasPermission } from "@/lib/permissions";
import {
  PATIENT_CLOSE_ROLES,
  PATIENT_HISTORY_ROLES,
  type Role
} from "@/business/rbac";
import {
  buildPatientPdfBody,
  patientDisplayName,
  patientListPosition,
  type PatientDocRef,
  type PatientListRow
} from "@/lib/patientUi";
import type { PatientPermissionsDto } from "@/validation/patientDto";

interface RelativeContact {
  name: string;
  phone: string;
}

interface PatientFormState {
  id: string;
  full_name: string;
  dob: string;
  age: number | string;
  gender: string;
  address: string;
  area: string;
  city: string;
  pincode: string;
  mobile: string;
  disease_condition: string;
  assigned_staff_id: string;
  shift_type: string;
  start_date: string;
  status: string;
  status_reason: string;
  status_reason_other: string;
  photo: PatientDocRef | null;
  documents: PatientDocRef[];
  relative_contacts: RelativeContact[];
  expected_updated_at: string;
  confirm_duplicate_name: boolean;
  aadhar?: string;
}

type PatientsAuth = {
  session?: { access_token?: string } | null;
  profile?: { role?: string } | null;
  supabase?: unknown;
};

interface EmployeeOption {
  id: string;
  full_name?: string;
  name?: string;
  role?: string;
}

interface CloseDialogState {
  id: string;
  name: string;
  reason: string;
  reason_other: string;
}

interface ReopenDialogState {
  id: string;
  name: string;
  note: string;
}

interface HistoryDialogState {
  id: string;
  name: string;
}

interface ConflictPromptState {
  actual?: string;
  message?: string;
}

interface DuplicatePromptState {
  message: string;
}

interface BillingHistoryRow {
  id?: string;
  status?: string | null;
  total?: number | string | null;
  amount?: number | string | null;
  created_at?: string | null;
  created?: string | null;
}

interface DutyHistoryRow {
  id?: string;
  employee_id?: string | null;
  caretaker_id?: string | null;
  shift?: string | null;
  shift_type?: string | null;
  status?: string | null;
  start_at?: string | null;
  start_date?: string | null;
  created_at?: string | null;
}

interface ReceiptHistoryRow {
  id?: string;
  billing_id?: string | null;
  method?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
  created?: string | null;
}

interface AuditHistoryRow {
  id?: string;
  created_at?: string | null;
  actor?: string | null;
  user_id?: string | null;
  action?: string | null;
  stamp?: string | null;
}

interface PatientHistoryBundle {
  patient?: PatientListRow;
  billings?: BillingHistoryRow[];
  receipts?: ReceiptHistoryRow[];
  duties?: DutyHistoryRow[];
  audits?: AuditHistoryRow[];
  linkCounts?: { billings?: number; duties?: number };
}

function sessionOrNull(auth: PatientsAuth) {
  return (auth.session ?? null) as import("@supabase/supabase-js").Session | null;
}

function roleInList(role: unknown, list: readonly Role[]): boolean {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  return list.some((r) => r.toLowerCase() === normalized);
}

function emptyRelative() {
  return { name: "", phone: "" };
}

function createInitialForm(): PatientFormState {
  return {
    id: "",
    full_name: "",
    dob: "",
    age: 0,
    gender: "Female",
    address: "",
    area: "",
    city: "Ahmedabad",
    pincode: "",
    mobile: "",
    disease_condition: "",
    assigned_staff_id: "",
    shift_type: "DAY",
    start_date: crmTodayIso(),
    status: "Active",
    status_reason: "",
    status_reason_other: "",
    photo: null,
    documents: [],
    relative_contacts: [emptyRelative(), emptyRelative(), emptyRelative()],
    expected_updated_at: "",
    confirm_duplicate_name: false
  };
}

function deriveAgeFromDob(dob: string | undefined | null): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age < 0 ? 0 : age;
}

function patientRowPermissions(row: PatientListRow): PatientPermissionsDto {
  return (
    row.permissions || {
      canEdit: false,
      canAssignCaretaker: false,
      canClose: false,
      canReopen: false,
      canHardDelete: false
    }
  );
}

export default function PatientsPage() {
  const auth = useAuth() as unknown as PatientsAuth;
  const accessToken = auth.session?.access_token ?? "";
  const canWrite = hasPermission(auth.profile?.role, "patients.write");
  const canClose = roleInList(auth.profile?.role, PATIENT_CLOSE_ROLES);
  const canViewHistory = roleInList(auth.profile?.role, PATIENT_HISTORY_ROLES);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [pinFilter, setPinFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  useEffect(
    function () {
      const handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  const listQuery = useMemo(
    function () {
      return {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        gender: genderFilter || undefined,
        area: areaFilter || undefined,
        pin: pinFilter || undefined,
        shift: shiftFilter || undefined
      };
    },
    [debouncedSearch, statusFilter, genderFilter, areaFilter, pinFilter, shiftFilter]
  );

  const resource = usePaginatedResource<PatientListRow>({
    list: patientsClient.list,
    table: "hh_patients",
    channel: "hh_patients",
    queryParams: listQuery,
    resetKey:
      debouncedSearch +
      "|" +
      statusFilter +
      "|" +
      genderFilter +
      "|" +
      areaFilter +
      "|" +
      pinFilter +
      "|" +
      shiftFilter,
    pageSize: 50
  });
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [form, setForm] = useState<PatientFormState>(createInitialForm);
  const [formPermissions, setFormPermissions] = useState<PatientPermissionsDto | null>(null);
  // P1-36: stable per-form-session resource id for uploads that happen
  // BEFORE the patient is persisted (new-patient flow). Once form.id
  // exists we prefer that; otherwise this draft-id keeps every file
  // attached to a single patient form clustered under the same prefix.
  const draftIdRef = useRef(
    "draft-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
  const { busy, tryBegin, end } = useBusyGuard();
  const [message, setMessageState] = useState("");
  const [error, setErrorState] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
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
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPromptState | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePromptState | null>(null);
  const [closeDialog, setCloseDialog] = useState<CloseDialogState | null>(null);
  const [reopenDialog, setReopenDialog] = useState<ReopenDialogState | null>(null);
  const [historyDialog, setHistoryDialog] = useState<HistoryDialogState | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [historyData, setHistoryData] = useState<PatientHistoryBundle | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";
  const authRef = useRef(auth);
  authRef.current = auth;

  const loadEmployees = useCallback(function () {
    if (!accessToken) return undefined;
    let cancelled = false;
    lookupsClient
      .employees(sessionOrNull(authRef.current))
      .then(function (rows: EmployeeOption[]) {
        if (!cancelled) setEmployees(Array.isArray(rows) ? rows : []);
      })
      .catch(function (lookupError: unknown) {
        if (cancelled) return;
        setEmployees([]);
        const msg =
          lookupError &&
          typeof lookupError === "object" &&
          "message" in lookupError &&
          typeof (lookupError as { message?: unknown }).message === "string"
            ? (lookupError as { message: string }).message
            : "unknown error";
        setError(
          "Could not load the employee list — " + msg + ". Assignment lists may be incomplete."
        );
      });
    return function () {
      cancelled = true;
    };
  }, [accessToken, setError]);

  useEffect(
    function () {
      return loadEmployees();
    },
    [loadEmployees]
  );

  const rows = useMemo(
    function (): PatientListRow[] {
      const data = resource.data || [];
      return data
        .slice()
        .sort(function (left, right) {
          const leftTime = new Date(left.registered_at || left.created_at || left.created || 0).getTime();
          const rightTime = new Date(right.registered_at || right.created_at || right.created || 0).getTime();
          return sortOrder === "asc" ? leftTime - rightTime : rightTime - leftTime;
        });
    },
    [resource.data, sortOrder]
  );

  function caretakerLabel(employeeId: string | undefined | null) {
    if (!employeeId) return "";
    const hit = employees.find(function (employee) {
      return employee.id === employeeId;
    });
    return hit ? (hit.full_name || hit.name || employeeId) : employeeId;
  }

  function updateField<K extends keyof PatientFormState>(name: K, value: PatientFormState[K]) {
    setForm(function (current) {
      const next = { ...current, [name]: value };
      if (name === "dob") {
        next.age = deriveAgeFromDob(String(value ?? "")) || current.age;
      }
      return next;
    });
  }

  function updateContact(index: number, key: keyof RelativeContact, value: string) {
    setForm(function (current) {
      const next = current.relative_contacts.slice();
      next[index] = { ...(next[index] || { name: "", phone: "" }), [key]: value };
      return { ...current, relative_contacts: next };
    });
  }

  function exportPatientsCsv() {
    downloadCsv(
      "patients.csv",
      rows.map(function (row) {
        return {
          patient_id: row.id,
          name: row.full_name || row.name,
          dob: row.dob || "",
          age_gender: String(row.age || "") + " / " + String(row.gender || ""),
          phone: row.mobile || row.phone || "",
          address: row.address || row.addr || "",
          area: row.area || "",
          city: row.city || "",
          pincode: row.pincode || row.pin || "",
          registered: row.registered_at || row.created_at || row.created || "",
          status: row.status || "",
          status_reason: row.status_reason || row.close_reason || "",
          shift_type: row.shift_type || row.shift || "",
          disease_condition: row.disease_condition || "",
          assigned_staff: caretakerLabel(row.caretaker_id || row.assigned_staff_id),
          relname1: row.relname || "",
          relphone1: row.relphone || "",
          relname2: row.relname2 || "",
          relphone2: row.relphone2 || "",
          relname3: row.relname3 || "",
          relphone3: row.relphone3 || ""
        };
      })
    );
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const uploaded: PatientDocRef[] = [];
      const patientResourceId = form.id || draftIdRef.current;
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file) continue;
        uploaded.push(
          await uploadDocument({
            bucket: "patient-documents",
            file,
            session: sessionOrNull(auth),
            supabase: auth.supabase,
            resource: "Patients",
            resourceId: patientResourceId
          })
        );
      }
      setForm(function (current) {
        return { ...current, documents: current.documents.concat(uploaded) };
      });
      setMessage("Patient documents uploaded");
    } catch (uploadError: unknown) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload patient documents"
      );
    } finally {
      end();
      event.target.value = "";
    }
  }

  async function uploadPhotoFile(file: File | null | undefined) {
    if (!file) return;
    if (!tryBegin()) return;
    setError("");
    try {
      const uploaded = await uploadDocument({
        bucket: "patient-documents",
        file: file,
        session: sessionOrNull(auth),
        supabase: auth.supabase,
        resource: "Patients",
        resourceId: form.id || draftIdRef.current
      });
      setForm(function (current) { return { ...current, photo: uploaded }; });
      setMessage("Patient photo uploaded");
    } catch (uploadError: unknown) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Unable to upload photo"
      );
    } finally {
      end();
    }
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = (event.target.files || [])[0];
    event.target.value = "";
    await uploadPhotoFile(file);
  }

  async function handleCameraCapture(file: File) {
    setCameraOpen(false);
    await uploadPhotoFile(file);
  }

  function editPatient(row: PatientListRow) {
    setError("");
    setMessage("");
    const rels = [
      { name: row.relname || "", phone: row.relphone || "" },
      { name: row.relname2 || "", phone: row.relphone2 || "" },
      { name: row.relname3 || "", phone: row.relphone3 || "" }
    ];
    if (Array.isArray(row.relative_contacts) && row.relative_contacts.length) {
      for (let i = 0; i < Math.min(3, row.relative_contacts.length); i += 1) {
        const contact = row.relative_contacts[i];
        if (!contact) continue;
        rels[i] = {
          name: contact.name || rels[i]?.name || "",
          phone: contact.phone || rels[i]?.phone || ""
        };
      }
    }
    setForm({
      id: row.id,
      full_name: row.full_name || row.name || "",
      dob: row.dob || "",
      age: row.age || deriveAgeFromDob(row.dob) || 0,
      gender: row.gender || "Female",
      address: row.address || row.addr || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      pincode: row.pincode || row.pin || "",
      mobile: row.mobile || row.phone || "",
      disease_condition: row.disease_condition || "",
      assigned_staff_id: row.assigned_staff_id || row.caretaker_id || "",
      shift_type: row.shift_type || row.shift || "DAY",
      start_date: row.start_date || (row.created_at || "").slice(0, 10) || crmTodayIso(),
      status: row.status || "Active",
      status_reason: row.status_reason || row.close_reason || "",
      status_reason_other: row.status_reason_other || row.close_reason_other || "",
      photo: row.photo && typeof row.photo === "object" ? row.photo : null,
      documents: row.patient_documents || row.docs || [],
      relative_contacts: rels,
      expected_updated_at: row.updated_at || "",
      confirm_duplicate_name: false
    });
    setFormPermissions(patientRowPermissions(row));
    if (!row.updated_at) {
      setMessage(
        "Loaded a legacy patient without a last-modified timestamp — concurrent edit detection is disabled for this record. Save with care."
      );
    }
  }

  function resetForm() {
    setForm(createInitialForm());
    setFormPermissions(null);
    setError("");
    setMessage("");
  }

  async function submitForm(formOverride?: PatientFormState) {
    const current = formOverride ?? form;
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    setConflictPrompt(null);
    setDuplicatePrompt(null);
    try {
      if (current.status !== "Active" && !current.id && !current.status_reason.trim()) {
        throw new Error("Reason is required when patient is not Active");
      }
      if (current.status_reason === "Other" && !current.status_reason_other.trim()) {
        throw new Error("Specify the other reason for " + current.status);
      }
      const payload: Record<string, unknown> = {
        id: current.id || undefined,
        full_name: current.full_name,
        name: current.full_name,
        dob: current.dob || "",
        age: String(current.age || ""),
        gender: current.gender,
        address: current.address || "",
        addr: current.address || "",
        area: current.area,
        city: current.city,
        pincode: current.pincode,
        pin: current.pincode,
        mobile: current.mobile,
        phone: current.mobile,
        disease_condition: current.disease_condition,
        assigned_staff_id: current.assigned_staff_id || undefined,
        caretaker_id: current.assigned_staff_id || undefined,
        shift_type: current.shift_type,
        start_date: current.start_date,
        status: current.status,
        status_reason: current.status_reason || "",
        status_reason_other: current.status_reason_other || "",
        relname: current.relative_contacts[0]?.name || "",
        relphone: current.relative_contacts[0]?.phone || "",
        relname2: current.relative_contacts[1]?.name || "",
        relphone2: current.relative_contacts[1]?.phone || "",
        relname3: current.relative_contacts[2]?.name || "",
        relphone3: current.relative_contacts[2]?.phone || "",
        relative_contacts: current.relative_contacts.filter(function (item) {
          return item.name && item.phone;
        }),
        photo: current.photo || undefined,
        docs: current.documents,
        documents: current.documents
      };
      if (current.id && current.expected_updated_at) {
        payload.expected_updated_at = current.expected_updated_at;
      }
      if (current.confirm_duplicate_name) {
        payload.confirm_duplicate_name = true;
      }
      await patientsClient.save(sessionOrNull(auth), payload);
      await resource.reload();
      resetForm();
      setMessage(current.id ? "Patient updated successfully" : "Patient created successfully");
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
          message:
            err.message ||
            "Patient was modified by another user — reload to see their changes."
        });
      } else if (code === "duplicate" && err?.details?.field === "name" && !current.id) {
        setDuplicatePrompt({
          message: err.message || "An active patient with this name already exists."
        });
      } else {
        setError(err.message || "Unable to save patient");
      }
    } finally {
      end();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      setError("You do not have permission to create or edit patients.");
      return;
    }
    return submitForm();
  }

  async function reloadPatientFromConflict() {
    if (!form.id) {
      setConflictPrompt(null);
      return;
    }
    if (!tryBegin()) return;
    setError("");
    try {
      const fresh = await patientsClient.get(sessionOrNull(auth), form.id);
      editPatient(fresh);
      setConflictPrompt(null);
      setMessage("Patient reloaded — your previous edits were discarded.");
    } catch (reloadError: unknown) {
      setError(
        reloadError instanceof Error ? reloadError.message : "Could not reload patient."
      );
    } finally {
      end();
    }
  }

  async function confirmDuplicateAndResubmit() {
    setDuplicatePrompt(null);
    const next = { ...form, confirm_duplicate_name: true };
    setForm(next);
    await submitForm(next);
  }

  function openCloseDialog(row: PatientListRow) {
    setError("");
    setMessage("");
    setCloseDialog({
      id: row.id,
      name: row.full_name || row.name || row.id,
      reason: "",
      reason_other: ""
    });
  }

  async function submitCloseDialog() {
    if (!closeDialog) return;
    if (!closeDialog.reason) {
      setError("Pick a reason to close this patient");
      return;
    }
    if (closeDialog.reason === "Other" && !closeDialog.reason_other.trim()) {
      setError("Specify the other reason");
      return;
    }
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    try {
      await patientsClient.close(sessionOrNull(auth), closeDialog.id, {
        reason: closeDialog.reason,
        reason_other: closeDialog.reason_other
      });
      await resource.reload();
      if (form.id === closeDialog.id) resetForm();
      setMessage("Patient closed");
      setCloseDialog(null);
    } catch (closeError: unknown) {
      setError(
        closeError instanceof Error ? closeError.message : "Unable to close patient"
      );
    } finally {
      end();
    }
  }

  function openReopenDialog(row: PatientListRow) {
    setError("");
    setMessage("");
    setReopenDialog({
      id: row.id,
      name: row.full_name || row.name || row.id,
      note: ""
    });
  }

  async function submitReopenDialog() {
    if (!reopenDialog) return;
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    try {
      await patientsClient.reopen(
        sessionOrNull(auth),
        reopenDialog.id,
        reopenDialog.note.trim() ? { reason: reopenDialog.note.trim() } : {}
      );
      await resource.reload();
      if (form.id === reopenDialog.id) resetForm();
      setMessage("Patient reopened");
      setReopenDialog(null);
    } catch (reopenError: unknown) {
      setError(
        reopenError instanceof Error ? reopenError.message : "Unable to reopen patient"
      );
    } finally {
      end();
    }
  }

  async function deletePatientPermanently(id: string) {
    if (!isAdmin) {
      setError("Only an Admin can permanently delete patients.");
      return;
    }
    const ok = await confirm({
      title: "Permanently delete patient?",
      description:
        "This cannot be undone. If the patient has any billings, duties, or receipts, the delete will be refused.",
      confirmLabel: "Delete permanently",
      tone: "danger"
    });
    if (!ok) return;
    if (!tryBegin()) return;
    setError("");
    setMessage("");
    try {
      await patientsClient.hardDelete(sessionOrNull(auth), id);
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Patient permanently deleted");
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete patient"
      );
    } finally {
      end();
    }
  }

  async function openHistory(row: PatientListRow) {
    setHistoryDialog({ id: row.id, name: row.full_name || row.name || row.id });
    setHistoryData(null);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const bundle = await patientsClient.history(sessionOrNull(auth), row.id);
      setHistoryData(bundle as PatientHistoryBundle);
    } catch (historyErr: unknown) {
      setHistoryError(
        historyErr instanceof Error ? historyErr.message : "Could not load patient history"
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryDialog(null);
    setHistoryData(null);
    setHistoryError("");
    setHistoryLoading(false);
  }

  async function resolvePatientDocLinks(docs: PatientDocRef[]) {
    if (!Array.isArray(docs) || !docs.length || !auth.session) return [];
    const resolved = [];
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      try {
        const data = await getDocumentSignedUrl(d, sessionOrNull(auth), { expiresIn: 1800 });
        resolved.push({ ...d, signedUrl: data && data.signedUrl ? data.signedUrl : "" });
      } catch (_e) {
        resolved.push({ ...d, signedUrl: "" });
      }
    }
    return resolved;
  }

  async function openPatientPdf(row: PatientListRow, hideSensitive: boolean) {
    const preOpened = preOpenPrintWindow();
    if (!preOpened) {
      reportPrintBlocked(setError);
      return;
    }
    const rawDocs = row.patient_documents || row.docs || [];
    const photoDoc =
      row.photo && typeof row.photo === "object" && row.photo.path ? row.photo : null;
    const resolvedDocs = await resolvePatientDocLinks(rawDocs);
    const resolvedPhoto = photoDoc ? (await resolvePatientDocLinks([photoDoc]))[0] : null;
    const body = buildPatientPdfBody(
      row,
      hideSensitive,
      resolvedDocs,
      resolvedPhoto,
      caretakerLabel(row.caretaker_id || row.assigned_staff_id || "")
    );
    openPrintWindow(
      hideSensitive
        ? "Patient Profile (sanitised)"
        : "Patient Profile - " + patientDisplayName(row),
      body,
      preOpened
    );
  }

  return (
    <AuthGuard permission="patients.read">
      <AppShell title="Patients">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit Patient" : "Add Patient"}
            description="Full demographic profile with relatives, photo, docs and status workflow."
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="patients-name-1">Name</label>
                  <input id="patients-name-1" value={form.full_name} onChange={function (event) { updateField("full_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-mobile-2">Mobile</label>
                  <input id="patients-mobile-2" type="tel" inputMode="tel" value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-date-of-birth-3">Date of birth</label>
                  <input id="patients-date-of-birth-3"
                    type="date"
                    max={crmTodayIso()}
                    value={form.dob}
                    onChange={function (event) { updateField("dob", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-aadhar-4">Aadhar</label>
                  <input id="patients-aadhar-4"
                    value={form.aadhar || ""}
                    onChange={function (event) { updateField("aadhar", event.target.value); }}
                    pattern="\d{12}"
                    maxLength={12}
                    inputMode="numeric"
                    placeholder="123456789012"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-age-5">Age</label>
                  <input id="patients-age-5"
                    type="number"
                    min="0"
                    value={form.age}
                    onChange={function (event) { updateField("age", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-gender-6">Gender</label>
                  <select id="patients-gender-6" value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-shift-7">Shift</label>
                  <select id="patients-shift-7" value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-start-date-8">Start date</label>
                  <input id="patients-start-date-8"
                    type="date"
                    max={patientStartDateMax()}
                    value={form.start_date}
                    onChange={function (event) { updateField("start_date", event.target.value); }}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="patients-disease-condition-9">Disease / condition</label>
                <textarea id="patients-disease-condition-9" rows={3} value={form.disease_condition} onChange={function (event) { updateField("disease_condition", event.target.value); }} />
              </div>
              <div className="field">
                <label htmlFor="patients-address-10">Address</label>
                <textarea id="patients-address-10" rows={3} maxLength={500} value={form.address} onChange={function (event) { updateField("address", event.target.value); }} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="patients-area-11">Area</label>
                  <input id="patients-area-11" value={form.area} onChange={function (event) { updateField("area", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-city-12">City</label>
                  <input id="patients-city-12" value={form.city} onChange={function (event) { updateField("city", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-pincode-13">Pincode</label>
                  <input id="patients-pincode-13" value={form.pincode} onChange={function (event) { updateField("pincode", event.target.value); }} required />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="patients-assigned-staff-14">Assigned staff</label>
                  <select
                    id="patients-assigned-staff-14"
                    value={form.assigned_staff_id}
                    disabled={
                      Boolean(
                        form.id &&
                          formPermissions &&
                          !formPermissions.canAssignCaretaker
                      )
                    }
                    title={
                      formPermissions && formPermissions.blockReasons
                        ? formPermissions.blockReasons.canAssignCaretaker
                        : undefined
                    }
                    onChange={function (event) {
                      updateField("assigned_staff_id", event.target.value);
                    }}
                  >
                    <option value="">No assignment</option>
                    {employees.map(function (employee) {
                      return (
                        <option key={employee.id} value={employee.id}>
                          {(employee.full_name || employee.name) + (employee.role ? " (" + slugToText(employee.role) + ")" : "")}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-status-15">Status</label>
                  <select
                    id="patients-status-15"
                    value={form.status}
                    onChange={function (event) { updateField("status", event.target.value); }}
                    disabled={Boolean(form.id)}
                    title={
                      form.id
                        ? "Use Close or Reopen on the registry — status changes run the cascade workflow."
                        : undefined
                    }
                  >
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                  {form.id ? (
                    <small className="mini-muted" style={{ marginTop: 4, display: "block" }}>
                      Status changes use Close or Reopen on the patient registry (not this form).
                    </small>
                  ) : null}
                </div>
              </div>
              {form.status !== "Active" ? (
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="patients-reason-16">Reason</label>
                    <select id="patients-reason-16" value={form.status_reason} onChange={function (event) { updateField("status_reason", event.target.value); }} required>
                      <option value="">Select reason</option>
                      {patientCloseReasonOptions.map(function (r) {
                        return <option key={r} value={r}>{r}</option>;
                      })}
                    </select>
                  </div>
                  {form.status_reason === "Other" ? (
                    <div className="field">
                      <label htmlFor="patients-specify-other-reason-17">Specify other reason</label>
                      <input id="patients-specify-other-reason-17"
                        value={form.status_reason_other}
                        onChange={function (event) { updateField("status_reason_other", event.target.value); }}
                        required
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="stack">
                <strong>Relatives / emergency contacts</strong>
                {form.relative_contacts.map(function (contact, index) {
                  const nameId = "patients-relative-" + index + "-name";
                  const phoneId = "patients-relative-" + index + "-phone";
                  return (
                    <div className="grid-2" key={"relative-" + index}>
                      <div className="field">
                        <label htmlFor={nameId}>Relative {index + 1} name {index === 0 ? "*" : ""}</label>
                        <input id={nameId} value={contact.name} onChange={function (event) { updateContact(index, "name", event.target.value); }} required={index === 0} />
                      </div>
                      <div className="field">
                        <label htmlFor={phoneId}>Relative {index + 1} phone {index === 0 ? "*" : ""}</label>
                        <input id={phoneId} type="tel" inputMode="tel" value={contact.phone} onChange={function (event) { updateContact(index, "phone", event.target.value); }} required={index === 0} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="patients-patient-photo-20">Patient photo</label>
                  <div className="button-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input id="patients-patient-photo-20"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                    />
                    <button
                      type="button"
                      className="button ghost"
                      onClick={function () { setCameraOpen(true); }}
                    >
                      Use camera
                    </button>
                  </div>
                  {form.photo ? (
                    <div style={{ marginTop: 8 }}>
                      <DocumentCard doc={form.photo} session={sessionOrNull(auth)} />
                    </div>
                  ) : (
                    <small>Optional. On mobile the file picker also opens the camera.</small>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="patients-documents-form-documents-21">Documents ({form.documents.length})</label>
                  <input id="patients-documents-form-documents-21"
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleUpload}
                  />
                  <small>Discharge, prescriptions, IDs. JPG/PNG/HEIC/PDF up to 25 MB each.</small>
                </div>
              </div>
              <DocumentList
                docs={form.documents}
                session={sessionOrNull(auth)}
                onRemove={function (doc: PatientDocRef) {
                  setForm(function (current) {
                    return {
                      ...current,
                      documents: current.documents.filter(function (item) {
                        return item.path !== doc.path;
                      })
                    };
                  });
                }}
              />
              {conflictPrompt ? (
                <div
                  className="error-text"
                  style={{
                    border: "1px solid var(--warn, #d97706)",
                    background: "rgba(217,119,6,0.08)",
                    padding: "10px 12px",
                    borderRadius: 6
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <strong>Concurrent edit detected.</strong> {conflictPrompt.message}
                    {conflictPrompt.actual ? (
                      <span className="mini-muted">
                        {" "}(server updated_at: {String(conflictPrompt.actual)})
                      </span>
                    ) : null}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button
                      className="button primary"
                      type="button"
                      onClick={reloadPatientFromConflict}
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
                      Keep my changes
                    </button>
                  </div>
                </div>
              ) : null}
              {duplicatePrompt ? (
                <div
                  className="error-text"
                  style={{
                    border: "1px solid var(--warn, #d97706)",
                    background: "rgba(217,119,6,0.08)",
                    padding: "10px 12px",
                    borderRadius: 6
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <strong>Possible duplicate.</strong> {duplicatePrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button
                      className="button primary"
                      type="button"
                      onClick={confirmDuplicateAndResubmit}
                      disabled={busy}
                    >
                      Create as new patient anyway
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={function () { setDuplicatePrompt(null); }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <ErrorBanner
                message={
                  error && !conflictPrompt && !duplicatePrompt
                    ? error
                    : !error && resource.error
                      ? `Live patient list error — ${resource.error}`
                      : ""
                }
              />
              <SuccessBanner message={message} />
              {canWrite ? (
                <div className="button-row">
                  <button
                    className="button primary"
                    type="submit"
                    disabled={Boolean(
                      busy || (form.id && formPermissions && !formPermissions.canEdit)
                    )}
                    title={
                      formPermissions && formPermissions.blockReasons
                        ? formPermissions.blockReasons.canEdit
                        : undefined
                    }
                  >
                    {busy ? "Saving..." : form.id ? "Update patient" : "Create patient"}
                  </button>
                  <button className="button secondary" type="button" onClick={resetForm}>
                    Clear
                  </button>
                </div>
              ) : (
                <p className="mini-muted">You have read-only access to patient records.</p>
              )}
            </form>
          </ModuleShell>

          <div className="page-grid">
            <ModuleShell
              title="Patient registry"
              description="Live ledger with status filter, CSV export and click-through edit."
              actions={
                <div className="button-row">
                  <button className="button secondary" type="button" onClick={exportPatientsCsv}>
                    Export CSV
                  </button>
                  <button className="button secondary" type="button" onClick={resource.reload}>
                    Refresh
                  </button>
                </div>
              }
            >
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="patients-search-22">Search</label>
                  <input id="patients-search-22"
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Name, mobile, address, area or pincode"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-status-23">Status</label>
                  <select id="patients-status-23" value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-gender-24">Gender</label>
                  <select id="patients-gender-24" value={genderFilter} onChange={function (event) { setGenderFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-shift-25">Shift</label>
                  <select id="patients-shift-25" value={shiftFilter} onChange={function (event) { setShiftFilter(event.target.value); }}>
                    <option value="">All</option>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-area-26">Area</label>
                  <input id="patients-area-26"
                    value={areaFilter}
                    onChange={function (event) { setAreaFilter(event.target.value); }}
                    placeholder="e.g. Naranpura"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-pincode-27">Pincode</label>
                  <input id="patients-pincode-27"
                    value={pinFilter}
                    onChange={function (event) { setPinFilter(event.target.value); }}
                    placeholder="e.g. 380013"
                    inputMode="numeric"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-sort-by-28">Sort by</label>
                  <select id="patients-sort-by-28" value={sortOrder} onChange={function (event) { setSortOrder(event.target.value); }}>
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
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
                {resource.total} patient{resource.total === 1 ? "" : "s"} total
                {resource.loading ? " (loading...)" : ""}
              </div>
              {!rows.length ? (
                <EmptyState
                  title={resource.loading ? "Loading patients..." : "No matching patients"}
                  description={
                    debouncedSearch
                      ? "No patient matches \"" + debouncedSearch + "\". Try fewer characters or a phone suffix."
                      : "Patients appear here as soon as they are created on any device."
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Age/Sex</th>
                        <th>Phone</th>
                        <th>Area</th>
                        <th>Status</th>
                        <th>Registered</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(function (row, index) {
                        const listRow = row as PatientListRow;
                        const rowNum = patientListPosition(resource.page, resource.pageSize, index);
                        return (
                          <tr key={row.id}>
                            <td>{rowNum}</td>
                            <td>{row.id}</td>
                            <td>
                              <div className="table-primary">{row.full_name || row.name}</div>
                            </td>
                            <td>{String(row.age || "-") + " / " + String(row.gender || "-")}</td>
                            <td>{row.mobile || row.phone || "-"}</td>
                            <td>{(row.area || "-") + ", " + (row.city || "")}</td>
                            <td>
                              <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                              {row.status_reason || row.close_reason ? (
                                <div className="mini-muted">{row.status_reason || row.close_reason}</div>
                              ) : null}
                            </td>
                            <td>{formatDate(row.registered_at || row.created_at || row.created)}</td>
                            <td>
                              <div className="button-row">
                                {canViewHistory ? (
                                  <button
                                    className="button ghost"
                                    type="button"
                                    onClick={function () { openHistory(listRow); }}
                                    disabled={busy}
                                  >
                                    History
                                  </button>
                                ) : null}
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={function () { openPatientPdf(listRow, false); }}
                                  disabled={busy}
                                  title="Print profile with photo + documents"
                                >
                                  Print
                                </button>
                                {canWrite && patientRowPermissions(listRow).canEdit ? (
                                  <button
                                    className="button secondary"
                                    type="button"
                                    onClick={function () { editPatient(listRow); }}
                                    disabled={busy}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {patientRowPermissions(listRow).canReopen ? (
                                  canClose ? (
                                    <button
                                      className="button secondary"
                                      type="button"
                                      onClick={function () { openReopenDialog(listRow); }}
                                      disabled={busy}
                                    >
                                      Reopen
                                    </button>
                                  ) : null
                                ) : null}
                                {isAdmin && patientRowPermissions(listRow).canHardDelete ? (
                                  <button
                                    className="button danger"
                                    type="button"
                                    onClick={function () { deletePatientPermanently(listRow.id); }}
                                    disabled={busy}
                                    title="Permanent delete (Admin only). Refused if linked billings, duties, or receipts exist."
                                  >
                                    Delete
                                  </button>
                                ) : null}
                                {canClose && patientRowPermissions(listRow).canClose ? (
                                  <button
                                    className="button danger"
                                    type="button"
                                    onClick={function () { openCloseDialog(listRow); }}
                                    disabled={busy}
                                  >
                                    Close
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ModuleShell>
          </div>
          {closeDialog ? (
            <ModalDialog
              open
              onClose={function () { setCloseDialog(null); }}
              onRequestClose={function () {
                const dirty =
                  closeDialog.reason === "Other" &&
                  closeDialog.reason_other.trim().length > 0;
                confirmDiscardTyped(confirm, dirty, function () { setCloseDialog(null); });
              }}
              lockClose={busy}
              title={"Close patient: " + closeDialog.name}
            >
                <p className="mini-muted">
                  Soft-close keeps all billings, duties and receipts. Pick a reason — it is
                  recorded in the audit log.
                </p>
                <div className="field">
                  <label htmlFor="patients-reason-29">Reason</label>
                  <select id="patients-reason-29"
                    value={closeDialog.reason}
                    onChange={function (event) {
                      const value = event.target.value;
                      setCloseDialog(function (d) {
                        return d ? { ...d, reason: value } : d;
                      });
                    }}
                    required
                  >
                    <option value="">Select reason</option>
                    {patientCloseReasonOptions.map(function (r) {
                      return <option key={r} value={r}>{r}</option>;
                    })}
                  </select>
                </div>
                {closeDialog.reason === "Other" ? (
                  <div className="field">
                    <label htmlFor="patients-specify-other-reason-30">Specify other reason</label>
                    <input id="patients-specify-other-reason-30"
                      value={closeDialog.reason_other}
                      onChange={function (event) {
                        const value = event.target.value;
                        setCloseDialog(function (d) {
                          return d ? { ...d, reason_other: value } : d;
                        });
                      }}
                      maxLength={500}
                    />
                  </div>
                ) : null}
                {error ? <div className="error-text">{error}</div> : null}
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={function () { setCloseDialog(null); }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    onClick={submitCloseDialog}
                    disabled={busy}
                  >
                    {busy ? "Closing..." : "Close patient"}
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {reopenDialog ? (
            <ModalDialog
              open
              onClose={function () { setReopenDialog(null); }}
              onRequestClose={function () {
                confirmDiscardTyped(
                  confirm,
                  reopenDialog.note.trim().length > 0,
                  function () { setReopenDialog(null); }
                );
              }}
              lockClose={busy}
              title={"Reopen patient: " + reopenDialog.name}
            >
                <p className="mini-muted">
                  Status will return to Active. If another active patient already uses this
                  mobile number, reopen will be refused.
                </p>
                <div className="field">
                  <label htmlFor="patients-note-optional-for-your-r-31">Note (optional, for your records)</label>
                  <textarea id="patients-note-optional-for-your-r-31"
                    rows={2}
                    value={reopenDialog.note}
                    onChange={function (event) {
                      const value = event.target.value;
                      setReopenDialog(function (d) {
                        return d ? { ...d, note: value } : d;
                      });
                    }}
                    maxLength={500}
                    placeholder="e.g. Returned from hospital"
                  />
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={function () { setReopenDialog(null); }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    onClick={submitReopenDialog}
                    disabled={busy}
                  >
                    {busy ? "Reopening..." : "Reopen as Active"}
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {historyDialog ? (
            <ModalDialog
              open
              onClose={closeHistory}
              className="panel modal-card modal-wide"
              labelledBy="patients-history-title"
            >
                <div className="modal-head">
                  <h3 id="patients-history-title">History — {historyDialog.name}</h3>
                  <button className="button ghost" type="button" onClick={closeHistory}>Close</button>
                </div>
                {historyLoading ? (
                  <p role="status" aria-live="polite">
                    Loading patient ledger...
                  </p>
                ) : null}
                {historyError ? <div className="error-text">{historyError}</div> : null}
                {historyData ? (
                  <div className="stack">
                    <div className="mini-muted">
                      Patient ID: {historyData.patient?.id || historyDialog.id}
                      {" · "}Status: {historyData.patient?.status || "—"}
                      {" · "}Billings: {historyData.linkCounts?.billings ?? 0}
                      {" · "}Duties: {historyData.linkCounts?.duties ?? 0}
                    </div>
                    <div>
                      <h4>Billings ({(historyData.billings || []).length})</h4>
                      {historyData.billings && historyData.billings.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Status</th><th>Total</th><th>Created</th></tr>
                            </thead>
                            <tbody>
                              {historyData.billings.map(function (b: BillingHistoryRow) {
                                return (
                                  <tr key={b.id}>
                                    <td>{b.id}</td>
                                    <td>{b.status || "—"}</td>
                                    <td>{b.total ?? b.amount ?? "—"}</td>
                                    <td>{formatDate(b.created_at || b.created)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No billings.</p>}
                    </div>
                    <div>
                      <h4>Duties ({(historyData.duties || []).length})</h4>
                      {historyData.duties && historyData.duties.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Employee</th><th>Shift</th><th>Status</th><th>Start</th></tr>
                            </thead>
                            <tbody>
                              {historyData.duties.map(function (d: DutyHistoryRow) {
                                return (
                                  <tr key={d.id}>
                                    <td>{d.id}</td>
                                    <td>{d.employee_id || d.caretaker_id || "—"}</td>
                                    <td>{d.shift || d.shift_type || "—"}</td>
                                    <td>{d.status || "—"}</td>
                                    <td>{formatDate(d.start_at || d.start_date || d.created_at)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No duties.</p>}
                    </div>
                    <div>
                      <h4>Receipts ({(historyData.receipts || []).length})</h4>
                      {historyData.receipts && historyData.receipts.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Billing</th><th>Method</th><th>Amount</th><th>Created</th></tr>
                            </thead>
                            <tbody>
                              {historyData.receipts.map(function (r: ReceiptHistoryRow) {
                                return (
                                  <tr key={r.id}>
                                    <td>{r.id}</td>
                                    <td>{r.billing_id}</td>
                                    <td>{r.method || "—"}</td>
                                    <td>{r.amount ?? "—"}</td>
                                    <td>{formatDate(r.created_at || r.created)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No receipts.</p>}
                    </div>
                    <div>
                      <h4>Audit trail ({(historyData.audits || []).length})</h4>
                      {historyData.audits && historyData.audits.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>When</th><th>Actor</th><th>Action</th><th>Note</th></tr>
                            </thead>
                            <tbody>
                              {historyData.audits.map(function (a: AuditHistoryRow) {
                                return (
                                  <tr key={a.id}>
                                    <td>{formatDate(a.created_at)}</td>
                                    <td>{a.actor || a.user_id || "—"}</td>
                                    <td>{a.action || "—"}</td>
                                    <td>{a.stamp || ""}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No audit entries.</p>}
                    </div>
                  </div>
                ) : null}
            </ModalDialog>
          ) : null}
        </div>
      </AppShell>

      <CameraCaptureModal
        open={cameraOpen}
        onClose={function () { setCameraOpen(false); }}
        onCapture={handleCameraCapture}
        facingMode="environment"
      />
    </AuthGuard>
  );
}
