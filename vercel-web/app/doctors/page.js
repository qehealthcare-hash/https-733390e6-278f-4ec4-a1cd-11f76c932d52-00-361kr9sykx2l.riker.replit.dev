"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { crmTodayIso } from "@/src/utils/crmToday";

function emptyForm() {
  return {
    id: "",
    fn: "",
    ln: "",
    gender: "Male",
    phone: "",
    email: "",
    city: "Ahmedabad",
    aadhar: "",
    pan: "",
    spec: "",
    qual: "",
    regno: "",
    regcouncil: "",
    regyear: "",
    clinic: "",
    clinicaddr: ""
  };
}

export default function DoctorsPage() {
  var auth = useAuth();
  var confirm = useConfirm();
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [city, setCity] = useState("");
  var [form, setForm] = useState(emptyForm());
  var [busy, setBusy] = useState(false);
  var [error, setErrorState] = useState("");
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

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", "200");
      if (search.trim()) qs.set("q", search.trim());
      if (city.trim()) qs.set("city", city.trim());
      var data = await request("/doctors?" + qs.toString(), null, auth.session);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load doctors");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, city]
  );

  var visible = useMemo(
    function () {
      if (!search.trim()) return rows;
      var n = search.trim().toLowerCase();
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

  function updateField(name, value) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function editRow(row) {
    setForm({
      id: row.id,
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
      clinicaddr: row.clinicaddr || ""
    });
    setError("");
    setMessage("");
  }

  function resetForm() {
    setForm(emptyForm());
    setError("");
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        form.id ? "/doctors/" + form.id : "/doctors",
        {
          method: form.id ? "PATCH" : "POST",
          body: {
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
          }
        },
        auth.session
      );
      setMessage(form.id ? "Doctor updated" : "Doctor created");
      resetForm();
      await reload();
    } catch (err) {
      setError(err.message || "Could not save doctor");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    var ok = await confirm({
      title: "Delete this doctor?",
      description: "The directory entry will be removed. This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/doctors/" + id, { method: "DELETE" }, auth.session);
      if (form.id === id) resetForm();
      setMessage("Doctor deleted");
      await reload();
    } catch (err) {
      setError(err.message || "Could not delete");
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
                  <input id="doctors-first-name-1" value={form.fn} onChange={function (event) { updateField("fn", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="doctors-last-name-2">Last name</label>
                  <input id="doctors-last-name-2" value={form.ln} onChange={function (event) { updateField("ln", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-gender-3">Gender</label>
                  <select id="doctors-gender-3" value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="doctors-phone-4">Phone</label>
                  <input id="doctors-phone-4" type="tel" inputMode="tel" value={form.phone} onChange={function (event) { updateField("phone", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="doctors-date-of-birth-5">Date of birth</label>
                  <input id="doctors-date-of-birth-5"
                    type="date"
                    max={crmTodayIso()}
                    value={form.dob || ""}
                    onChange={function (event) { updateField("dob", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="doctors-email-6">Email</label>
                  <input id="doctors-email-6" type="email" value={form.email} onChange={function (event) { updateField("email", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-city-7">City</label>
                  <input id="doctors-city-7" value={form.city} onChange={function (event) { updateField("city", event.target.value); }} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="doctors-specialisation-8">Specialisation</label>
                  <input id="doctors-specialisation-8" value={form.spec} onChange={function (event) { updateField("spec", event.target.value); }} placeholder="e.g. Cardiologist, Geriatric" />
                </div>
                <div className="field">
                  <label htmlFor="doctors-qualification-9">Qualification</label>
                  <input id="doctors-qualification-9" value={form.qual} onChange={function (event) { updateField("qual", event.target.value); }} placeholder="e.g. MBBS, MD" />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="doctors-registration-no-10">Registration no.</label>
                  <input id="doctors-registration-no-10" value={form.regno} onChange={function (event) { updateField("regno", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-registration-council-11">Registration council</label>
                  <input id="doctors-registration-council-11" value={form.regcouncil} onChange={function (event) { updateField("regcouncil", event.target.value); }} placeholder="e.g. GMC, MCI" />
                </div>
                <div className="field">
                  <label htmlFor="doctors-registration-year-12">Registration year</label>
                  <input id="doctors-registration-year-12" value={form.regyear} onChange={function (event) { updateField("regyear", event.target.value); }} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="doctors-clinic-hospital-name-13">Clinic / hospital name</label>
                  <input id="doctors-clinic-hospital-name-13" value={form.clinic} onChange={function (event) { updateField("clinic", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-clinic-address-14">Clinic address</label>
                  <input id="doctors-clinic-address-14" value={form.clinicaddr} onChange={function (event) { updateField("clinicaddr", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-aadhar-15">Aadhar</label>
                  <input id="doctors-aadhar-15" value={form.aadhar} onChange={function (event) { updateField("aadhar", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="doctors-pan-16">PAN</label>
                  <input id="doctors-pan-16" value={form.pan} onChange={function (event) { updateField("pan", event.target.value.toUpperCase()); }} />
                </div>
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : form.id ? "Update doctor" : "Create doctor"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell title="Doctor directory" description="Search by name, phone, clinic or specialisation.">
            <div className="toolbar">
              <div className="field">
                <label htmlFor="doctors-search-17">Search</label>
                <input id="doctors-search-17"
                  value={search}
                  onChange={function (event) { setSearch(event.target.value); }}
                  placeholder="Name, phone, clinic, specialisation"
                />
              </div>
              <div className="field">
                <label htmlFor="doctors-city-18">City</label>
                <input id="doctors-city-18"
                  value={city}
                  onChange={function (event) { setCity(event.target.value); }}
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
                            <div className="table-primary">{[r.fn, r.ln].filter(Boolean).join(" ")}</div>
                            <div className="mini-muted">{r.qual || ""}</div>
                          </td>
                          <td>{r.spec || "-"}</td>
                          <td>{r.phone || "-"}</td>
                          <td>{r.clinic || "-"}</td>
                          <td>{r.city || "-"}</td>
                          <td>
                            <div className="button-row">
                              <button className="button secondary" type="button" onClick={function () { editRow(r); }}>
                                Edit
                              </button>
                              <button className="button danger" type="button" onClick={function () { handleDelete(r.id); }}>
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
