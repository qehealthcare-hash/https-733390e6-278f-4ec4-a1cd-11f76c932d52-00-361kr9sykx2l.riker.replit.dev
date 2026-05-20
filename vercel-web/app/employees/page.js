"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { requestWithOfflineFallback } from "@/lib/api-client";
import { educationOptions, employeeRoleOptions, shiftOptions } from "@/lib/crm-options";
import { formatCurrency, formatMonth, slugToText } from "@/lib/formatters";
import { uploadDocument } from "@/lib/uploads";

function createInitialForm() {
  return {
    id: "",
    full_name: "",
    mobile: "",
    address: "",
    role: "NURSE",
    education: "ILLITERATE",
    shift_type: "DAY",
    active: true,
    documents: []
  };
}

export default function EmployeesPage() {
  var auth = useAuth();
  var resource = useRealtimeResource({
    apiPath: "/employees",
    table: "hh_employees",
    channel: "employees"
  });
  var [form, setForm] = useState(createInitialForm());
  var [busy, setBusy] = useState(false);
  var [search, setSearch] = useState("");
  var [roleFilter, setRoleFilter] = useState("");
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  var filtered = useMemo(
    function () {
      return resource.data.filter(function (row) {
        var hay = [row.full_name, row.mobile, row.address, row.role, row.education].join(" ").toLowerCase();
        var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
        var matchesRole = !roleFilter || row.role === roleFilter;
        return matchesSearch && matchesRole;
      });
    },
    [resource.data, search, roleFilter]
  );

  function updateField(name, value) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setMessage("");
  }

  function editEmployee(row) {
    setForm({
      id: row.id,
      full_name: row.full_name || "",
      mobile: row.mobile || "",
      address: row.address || "",
      role: row.role || "NURSE",
      education: row.education || "ILLITERATE",
      shift_type: row.shift_type || "DAY",
      active: row.active !== false,
      documents: row.employee_documents || []
    });
    setError("");
    setMessage("");
  }

  async function handleUpload(event) {
    var files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      var uploaded = [];
      for (var i = 0; i < files.length; i += 1) {
        uploaded.push(
          await uploadDocument({
            bucket: "employee-documents",
            file: files[i],
            session: auth.session,
            supabase: auth.supabase
          })
        );
      }
      setForm(function (current) {
        return {
          ...current,
          documents: current.documents.concat(uploaded)
        };
      });
      setMessage("Employee documents uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload employee documents");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!form.documents.length) {
        throw new Error("At least one employee document is required");
      }
      await requestWithOfflineFallback(
        form.id ? "/employees/" + form.id : "/employees",
        {
          method: form.id ? "PUT" : "POST",
          body: {
            full_name: form.full_name,
            mobile: form.mobile,
            address: form.address,
            role: form.role,
            education: form.education,
            shift_type: form.shift_type,
            active: form.active,
            documents: form.documents
          }
        },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(form.id ? "Employee updated successfully" : "Employee created successfully");
    } catch (submitError) {
      setError(submitError.message || "Unable to save employee");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEmployee(id) {
    if (!window.confirm("Delete this employee?")) return;
    setBusy(true);
    try {
      await requestWithOfflineFallback("/employees/" + id, { method: "DELETE" }, auth.session);
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Employee deleted");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete employee");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="employees.read">
      <AppShell title="Employees">
        <div className="page-split">
          <ModuleShell title={form.id ? "Edit Employee" : "Add Employee"} description="Nurse, attendant, staff, and accountant records with mandatory documents">
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label>Name</label>
                  <input value={form.full_name} onChange={function (event) { updateField("full_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Mobile</label>
                  <input value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Role</label>
                  <select value={form.role} onChange={function (event) { updateField("role", event.target.value); }}>
                    {employeeRoleOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Education</label>
                  <select value={form.education} onChange={function (event) { updateField("education", event.target.value); }}>
                    {educationOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={form.active ? "ACTIVE" : "INACTIVE"} onChange={function (event) { updateField("active", event.target.value === "ACTIVE"); }}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Address</label>
                <textarea rows="3" value={form.address} onChange={function (event) { updateField("address", event.target.value); }} required />
              </div>
              <div className="field">
                <label>Documents</label>
                <input type="file" multiple onChange={handleUpload} />
                <small>Aadhar, PAN, certificates, and other supporting staff files.</small>
              </div>
              <div className="document-list">
                {form.documents.map(function (doc, index) {
                  return (
                    <div className="document-item" key={doc.path || index}>
                      <div>{doc.file_name}</div>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={function () {
                          setForm(function (current) {
                            return {
                              ...current,
                              documents: current.documents.filter(function (item) {
                                return item.path !== doc.path;
                              })
                            };
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving..." : form.id ? "Update Employee" : "Create Employee"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <div className="page-grid">
            <ModuleShell title="Employee Registry" description="Document-backed workforce master with live sync">
              <div className="toolbar">
                <div className="field">
                  <label>Search</label>
                  <input value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Name, role, mobile or address" />
                </div>
                <div className="field">
                  <label>Role</label>
                  <select value={roleFilter} onChange={function (event) { setRoleFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeRoleOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
              </div>
              {!filtered.length ? (
                <EmptyState
                  title={resource.loading ? "Loading employees..." : "No matching staff"}
                  description="Your field workforce will appear here with their document-backed profiles and payout readiness."
                />
              ) : (
                <div className="record-list">
                  {filtered.map(function (row) {
                    var payoutRuns = row.payout_runs || [];
                    var totalPending = payoutRuns.reduce(function (sum, run) {
                      return sum + Number(run.pending_amount || 0);
                    }, 0);
                    return (
                      <div className="record-card" key={row.id}>
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{row.full_name}</h3>
                            <div className="record-meta">
                              <span>{row.mobile}</span>
                              <span>{slugToText(row.role)}</span>
                              <span>{slugToText(row.shift_type)}</span>
                            </div>
                          </div>
                          <span className={"status " + (row.active ? "active" : "paused")}>{row.active ? "Active" : "Inactive"}</span>
                        </div>
                        <div className="record-meta" style={{ marginTop: 12 }}>
                          <span>{slugToText(row.education)}</span>
                          <span>{row.employee_documents?.length || 0} documents</span>
                          <span>Pending payout {formatCurrency(totalPending)}</span>
                        </div>
                        {row.payout_runs?.length ? (
                          <div className="helper-box" style={{ marginTop: 12 }}>
                            Latest payout cycle: {formatMonth(row.payout_runs[0].payout_month)} | Pending {formatCurrency(row.payout_runs[0].pending_amount)}
                          </div>
                        ) : null}
                        <div className="button-row" style={{ marginTop: 12 }}>
                          <button className="button secondary" type="button" onClick={function () { editEmployee(row); }}>
                            Edit
                          </button>
                          <button className="button danger" type="button" onClick={function () { deleteEmployee(row.id); }}>
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
        </div>
      </AppShell>
    </AuthGuard>
  );
}
