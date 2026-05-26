"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";

function emptyForm() {
  return {
    id: "",
    name: "",
    contact: "",
    phone: "",
    email: "",
    gst: "",
    pan: "",
    addr: "",
    city: "Ahmedabad"
  };
}

export default function VendorsPage() {
  var auth = useAuth();
  var confirm = useConfirm();
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [city, setCity] = useState("");
  var [form, setForm] = useState(emptyForm());
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", "200");
      if (search.trim()) qs.set("q", search.trim());
      if (city.trim()) qs.set("city", city.trim());
      var data = await request("/vendors?" + qs.toString(), null, auth.session);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load vendors");
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
          String(r.name || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.contact || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.phone || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.gst || "").toLowerCase().indexOf(n) >= 0
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
      name: row.name || "",
      contact: row.contact || "",
      phone: row.phone || "",
      email: row.email || "",
      gst: row.gst || "",
      pan: row.pan || "",
      addr: row.addr || "",
      city: row.city || "Ahmedabad"
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
        form.id ? "/vendors/" + form.id : "/vendors",
        {
          method: form.id ? "PATCH" : "POST",
          body: {
            name: form.name,
            contact: form.contact,
            phone: form.phone,
            email: form.email,
            gst: form.gst,
            pan: form.pan,
            addr: form.addr,
            city: form.city
          }
        },
        auth.session
      );
      setMessage(form.id ? "Vendor updated" : "Vendor created");
      resetForm();
      await reload();
    } catch (err) {
      setError(err.message || "Could not save vendor");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    var ok = await confirm({
      title: "Delete this vendor?",
      description: "The vendor record will be removed.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/vendors/" + id, { method: "DELETE" }, auth.session);
      if (form.id === id) resetForm();
      setMessage("Vendor deleted");
      await reload();
    } catch (err) {
      setError(err.message || "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="vendors.read">
      <AppShell title="Vendors">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit vendor" : "Add vendor"}
            description="Suppliers, equipment partners, agencies & service vendors with GST."
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label>Vendor name</label>
                  <input value={form.name} onChange={function (event) { updateField("name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Contact person</label>
                  <input value={form.contact} onChange={function (event) { updateField("contact", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={form.phone} onChange={function (event) { updateField("phone", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={function (event) { updateField("email", event.target.value); }} />
                </div>
                <div className="field">
                  <label>GST number</label>
                  <input value={form.gst} onChange={function (event) { updateField("gst", event.target.value.toUpperCase()); }} />
                </div>
                <div className="field">
                  <label>PAN</label>
                  <input value={form.pan} onChange={function (event) { updateField("pan", event.target.value.toUpperCase()); }} />
                </div>
              </div>
              <div className="field">
                <label>Address</label>
                <textarea rows="2" value={form.addr} onChange={function (event) { updateField("addr", event.target.value); }} />
              </div>
              <div className="field">
                <label>City</label>
                <input value={form.city} onChange={function (event) { updateField("city", event.target.value); }} />
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : form.id ? "Update vendor" : "Create vendor"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell title="Vendor directory" description="Search by name, contact, phone or GST.">
            <div className="toolbar">
              <div className="field">
                <label>Search</label>
                <input
                  value={search}
                  onChange={function (event) { setSearch(event.target.value); }}
                  placeholder="Name, contact, phone, GST"
                />
              </div>
              <div className="field">
                <label>City</label>
                <input
                  value={city}
                  onChange={function (event) { setCity(event.target.value); }}
                  placeholder="Filter by city"
                />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="button secondary" type="button" onClick={reload}>
                  Refresh
                </button>
              </div>
            </div>
            {!visible.length ? (
              <EmptyState
                title={loading ? "Loading…" : "No vendors"}
                description="Add a vendor on the left to populate the directory."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>GST</th>
                      <th>City</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(function (r) {
                      return (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>{r.name || "-"}</td>
                          <td>{r.contact || "-"}</td>
                          <td>{r.phone || "-"}</td>
                          <td>{r.email || "-"}</td>
                          <td>{r.gst || "-"}</td>
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
