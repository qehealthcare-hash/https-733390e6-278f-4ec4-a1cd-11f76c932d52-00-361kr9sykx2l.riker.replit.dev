"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
import { useAuth } from "@/components/providers/auth-provider";
import { doctorsClient } from "@/lib/clients";
import { useRealtimeTableReload } from "@/hooks/use-realtime-table-reload";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { crmTodayIso } from "@/src/utils/crmToday";
import {
  apiErrorMessage,
  catalogExpectedUpdatedAt,
  emptyDoctorForm,
  isApiConflictError,
  type DoctorFormState,
  type DoctorListRow
} from "@/lib/doctorUi";

type DoctorsAuth = {
  session?: { access_token?: string } | null;
};

type DoctorListEnvelope = {
  rows?: DoctorListRow[];
};

const DOCTOR_LIST_CAP = 200;

export default function DoctorsPage() {
  const auth = useAuth() as unknown as DoctorsAuth;
  const accessToken = auth.session?.access_token;
  const confirm = useConfirm();
  const [rows, setRows] = useState<DoctorListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [form, setForm] = useState<DoctorFormState>(emptyDoctorForm);
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  const [conflictPrompt, setConflictPrompt] = useState<{
    message: string;
    actual?: string;
  } | null>(null);
  const toast = useToast();
  const setError = useCallback(
    function (msg: string) {
      const text = String(msg || "");
      setErrorState(text);
      if (text) toast.error(text);
    },
    [toast]
  );
  const setMessage = useCallback(
    function (msg: string) {
      const text = String(msg || "");
      setMessageState(text);
      if (text) toast.success(text);
    },
    [toast]
  );

  const reload = useCallback(async function () {
    if (!accessToken || !auth.session) return;
    setLoading(true);
    try {
      const data = (await doctorsClient.list(auth.session, {
        limit: DOCTOR_LIST_CAP,
        q: search.trim() || undefined,
        city: city.trim() || undefined
      })) as DoctorListEnvelope;
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load doctors");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, auth.session, city, search, setError]);

  useRealtimeTableReload(["hh_doctors"], "doctors", reload);

  useEffect(
    function () {
      if (!accessToken) return;
      reload();
    },
    [accessToken, city, reload]
  );

  const visible = useMemo(
    function () {
      if (!search.trim()) return rows;
      const n = search.trim().toLowerCase();
      return rows.filter(function (r) {
        return (
          String(r.fn || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.ln || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.phone || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.clinic || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.spec || "").toLowerCase().indexOf(n) >= 0
        );
      });
    },
    [rows, search]
  );

  function updateField(name: keyof DoctorFormState, value: string) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function editRow(row: DoctorListRow) {
    setConflictPrompt(null);
    setForm({
      id: row.id,
      expected_updated_at: catalogExpectedUpdatedAt(row),
      fn: row.fn || "",
      ln: row.ln || "",
      gender: row.gender || "Male",
      phone: row.phone || "",
      email: row.email || "",
      city: row.city || "Ahmedabad",
      aadhar: row.aadhar || "",
      pan: row.pan || "",
      spec: row.spec || "",
      qual: row.qual || "",
      regno: row.regno || "",
      regcouncil: row.regcouncil || "",
      regyear: row.regyear || "",
      clinic: row.clinic || "",
      clinicaddr: row.clinicaddr || "",
      dob: row.dob || ""
    });
    setError("");
    setMessage("");
  }

  function resetForm() {
    setForm(emptyDoctorForm());
    setError("");
    setMessage("");
    setConflictPrompt(null);
  }

  async function reloadDoctorFromConflict() {
    if (!auth.session || !form.id) return;
    setBusy(true);
    setError("");
    try {
      const row = (await doctorsClient.get(auth.session, form.id)) as DoctorListRow;
      editRow(row);
      setMessage("Reloaded latest doctor record");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not reload doctor"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth.session) return;
    setBusy(true);
    setError("");
    setMessage("");
    setConflictPrompt(null);
    try {
      const body: Record<string, unknown> = {
        fn: form.fn,
        ln: form.ln,
        gender: form.gender,
        phone: form.phone,
        email: form.email,
        city: form.city,
        aadhar: form.aadhar,
        pan: form.pan,
        spec: form.spec,
        qual: form.qual,
        regno: form.regno,
        regcouncil: form.regcouncil,
        regyear: form.regyear,
        clinic: form.clinic,
        clinicaddr: form.clinicaddr
      };
      if (form.id && form.expected_updated_at) {
        body.expected_updated_at = form.expected_updated_at;
      }
      await doctorsClient.save(auth.session, form.id || undefined, body);
      setMessage(form.id ? "Doctor updated" : "Doctor created");
      resetForm();
      await reload();
    } catch (err: unknown) {
      if (isApiConflictError(err)) {
        const details = (err as { details?: { actual_updated_at?: string } }).details;
        setConflictPrompt({
          message: apiErrorMessage(err, "Doctor was modified by another user — reload and try again."),
          actual: details?.actual_updated_at
        });
      } else {
        setError(apiErrorMessage(err, "Could not save doctor"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete this doctor?",
      description: "The directory entry will be removed. This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok || !auth.session) return;
    setBusy(true);
    setError("");
    try {
      await doctorsClient.remove(auth.session, id);
      if (form.id === id) resetForm();
      setMessage("Doctor deleted");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="doctors.read">
      <AppShell title="Doctors">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit doctor" : "Add doctor"}
            description="Referring doctors with specialisation, clinic and registration details."
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="doctors-first-name-1">First name</label>
                  <input
                    id="doctors-first-name-1"
                    value={form.fn}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("fn", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-last-name-2">Last name</label>
                  <input
                    id="doctors-last-name-2"
                    value={form.ln}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("ln", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-gender-3">Gender</label>
                  <select
                    id="doctors-gender-3"
                    value={form.gender}
                    onChange={function (event: ChangeEvent<HTMLSelectElement>) {
                      updateField("gender", event.target.value);
                    }}
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="doctors-phone-4">Phone</label>
                  <input
                    id="doctors-phone-4"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("phone", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-date-of-birth-5">Date of birth</label>
                  <input
                    id="doctors-date-of-birth-5"
                    type="date"
                    max={crmTodayIso()}
                    value={form.dob}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("dob", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-email-6">Email</label>
                  <input
                    id="doctors-email-6"
                    type="email"
                    value={form.email}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("email", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-city-7">City</label>
                  <input
                    id="doctors-city-7"
                    value={form.city}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("city", event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="doctors-specialisation-8">Specialisation</label>
                  <input
                    id="doctors-specialisation-8"
                    value={form.spec}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("spec", event.target.value);
                    }}
                    placeholder="e.g. Cardiologist, Geriatric"
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-qualification-9">Qualification</label>
                  <input
                    id="doctors-qualification-9"
                    value={form.qual}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("qual", event.target.value);
                    }}
                    placeholder="e.g. MBBS, MD"
                  />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="doctors-registration-no-10">Registration no.</label>
                  <input
                    id="doctors-registration-no-10"
                    value={form.regno}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("regno", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-registration-council-11">
                    Registration council
                  </label>
                  <input
                    id="doctors-registration-council-11"
                    value={form.regcouncil}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("regcouncil", event.target.value);
                    }}
                    placeholder="e.g. GMC, MCI"
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-registration-year-12">Registration year</label>
                  <input
                    id="doctors-registration-year-12"
                    value={form.regyear}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("regyear", event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="doctors-clinic-hospital-name-13">Clinic / hospital name</label>
                  <input
                    id="doctors-clinic-hospital-name-13"
                    value={form.clinic}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("clinic", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-clinic-address-14">Clinic address</label>
                  <input
                    id="doctors-clinic-address-14"
                    value={form.clinicaddr}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("clinicaddr", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-aadhar-15">Aadhar</label>
                  <input
                    id="doctors-aadhar-15"
                    value={form.aadhar}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("aadhar", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-pan-16">PAN</label>
                  <input
                    id="doctors-pan-16"
                    value={form.pan}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("pan", event.target.value.toUpperCase());
                    }}
                  />
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
                      onClick={reloadDoctorFromConflict}
                      disabled={Boolean(busy)}
                    >
                      Reload latest
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={function () {
                        setConflictPrompt(null);
                      }}
                      disabled={Boolean(busy)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
              <ErrorBanner message={error && !conflictPrompt ? error : ""} />
              <SuccessBanner message={message} />
              <div className="button-row">
                <button className="button primary" type="submit" disabled={Boolean(busy)}>
                  {busy ? "Saving…" : form.id ? "Update doctor" : "Create doctor"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell
            title="Doctor directory"
            description="Search by name, phone, clinic or specialisation."
          >
            <div className="toolbar">
              <div className="field">
                <label htmlFor="doctors-search-17">Search</label>
                <input
                  id="doctors-search-17"
                  value={search}
                  onChange={function (event: ChangeEvent<HTMLInputElement>) {
                    setSearch(event.target.value);
                  }}
                  placeholder="Name, phone, clinic, specialisation"
                />
              </div>
              <div className="field">
                <label htmlFor="doctors-city-18">City</label>
                <input
                  id="doctors-city-18"
                  value={city}
                  onChange={function (event: ChangeEvent<HTMLInputElement>) {
                    setCity(event.target.value);
                  }}
                  placeholder="Filter by city"
                />
              </div>
              <div className="field">
                <span aria-hidden="true">&nbsp;</span>
                <button className="button secondary" type="button" onClick={reload}>
                  Refresh
                </button>
              </div>
            </div>
            {rows.length >= DOCTOR_LIST_CAP ? (
              <p className="mini-muted" style={{ marginBottom: 8 }}>
                Showing first {DOCTOR_LIST_CAP} results. Refine search or filters to narrow the list.
              </p>
            ) : null}
            {!visible.length ? (
              <EmptyState
                title={loading ? "Loading…" : "No doctors"}
                description="Add a doctor on the left to start the directory."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Specialisation</th>
                      <th>Phone</th>
                      <th>Clinic</th>
                      <th>City</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(function (r) {
                      return (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>
                            <div className="table-primary">
                              {[r.fn, r.ln].filter(Boolean).join(" ")}
                            </div>
                            <div className="mini-muted">{r.qual || ""}</div>
                          </td>
                          <td>{r.spec || "-"}</td>
                          <td>{r.phone || "-"}</td>
                          <td>{r.clinic || "-"}</td>
                          <td>{r.city || "-"}</td>
                          <td>
                            <div className="button-row">
                              <button
                                className="button secondary"
                                type="button"
                                onClick={function () {
                                  editRow(r);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="button danger"
                                type="button"
                                onClick={function () {
                                  handleDelete(r.id);
                                }}
                              >
                                Delete
                              </button>
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
      </AppShell>
    </AuthGuard>
  );
}
