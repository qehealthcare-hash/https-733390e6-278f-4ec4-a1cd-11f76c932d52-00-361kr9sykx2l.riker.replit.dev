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
import { vendorsClient } from "@/lib/clients";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  apiErrorMessage,
  catalogExpectedUpdatedAt,
  emptyVendorForm,
  isApiConflictError,
  type VendorFormState,
  type VendorListRow
} from "@/lib/vendorUi";

type VendorsAuth = {
  session?: { access_token?: string } | null;
};

type VendorListEnvelope = {
  rows?: VendorListRow[];
};

const VENDOR_LIST_CAP = 200;

export default function VendorsPage() {
  const auth = useAuth() as unknown as VendorsAuth;
  const accessToken = auth.session?.access_token;
  const confirm = useConfirm();
  const [rows, setRows] = useState<VendorListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [form, setForm] = useState<VendorFormState>(emptyVendorForm);
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
      const data = (await vendorsClient.list(auth.session, {
        limit: VENDOR_LIST_CAP,
        q: search.trim() || undefined,
        city: city.trim() || undefined
      })) as VendorListEnvelope;
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load vendors");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, auth.session, city, search, setError]);

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
          String(r.name || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.contact || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.phone || "").toLowerCase().indexOf(n) >= 0 ||
          String(r.gst || "").toLowerCase().indexOf(n) >= 0
        );
      });
    },
    [rows, search]
  );

  function updateField(name: keyof VendorFormState, value: string) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function editRow(row: VendorListRow) {
    setConflictPrompt(null);
    setForm({
      id: row.id,
      expected_updated_at: catalogExpectedUpdatedAt(row),
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
    setForm(emptyVendorForm());
    setError("");
    setMessage("");
    setConflictPrompt(null);
  }

  async function reloadVendorFromConflict() {
    if (!auth.session || !form.id) return;
    setBusy(true);
    setError("");
    try {
      const row = (await vendorsClient.get(auth.session, form.id)) as VendorListRow;
      editRow(row);
      setMessage("Reloaded latest vendor record");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not reload vendor"));
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
        name: form.name,
        contact: form.contact,
        phone: form.phone,
        email: form.email,
        gst: form.gst,
        pan: form.pan,
        addr: form.addr,
        city: form.city
      };
      if (form.id && form.expected_updated_at) {
        body.expected_updated_at = form.expected_updated_at;
      }
      await vendorsClient.save(auth.session, form.id || undefined, body);
      setMessage(form.id ? "Vendor updated" : "Vendor created");
      resetForm();
      await reload();
    } catch (err: unknown) {
      if (isApiConflictError(err)) {
        const details = (err as { details?: { actual_updated_at?: string } }).details;
        setConflictPrompt({
          message: apiErrorMessage(err, "Vendor was modified by another user — reload and try again."),
          actual: details?.actual_updated_at
        });
      } else {
        setError(apiErrorMessage(err, "Could not save vendor"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete this vendor?",
      description: "The vendor record will be removed.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok || !auth.session) return;
    setBusy(true);
    setError("");
    try {
      await vendorsClient.remove(auth.session, id);
      if (form.id === id) resetForm();
      setMessage("Vendor deleted");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete");
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
                  <label htmlFor="vendors-vendor-name-1">Vendor name</label>
                  <input
                    id="vendors-vendor-name-1"
                    value={form.name}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("name", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendors-contact-person-2">Contact person</label>
                  <input
                    id="vendors-contact-person-2"
                    value={form.contact}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("contact", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendors-phone-3">Phone</label>
                  <input
                    id="vendors-phone-3"
                    value={form.phone}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("phone", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendors-email-4">Email</label>
                  <input
                    id="vendors-email-4"
                    type="email"
                    value={form.email}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("email", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendors-gst-number-5">GST number</label>
                  <input
                    id="vendors-gst-number-5"
                    value={form.gst}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("gst", event.target.value.toUpperCase());
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendors-pan-6">PAN</label>
                  <input
                    id="vendors-pan-6"
                    value={form.pan}
                    onChange={function (event: ChangeEvent<HTMLInputElement>) {
                      updateField("pan", event.target.value.toUpperCase());
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="vendors-address-7">Address</label>
                <textarea
                  id="vendors-address-7"
                  rows={2}
                  value={form.addr}
                  onChange={function (event: ChangeEvent<HTMLTextAreaElement>) {
                    updateField("addr", event.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="vendors-city-8">City</label>
                <input
                  id="vendors-city-8"
                  value={form.city}
                  onChange={function (event: ChangeEvent<HTMLInputElement>) {
                    updateField("city", event.target.value);
                  }}
                />
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
                      onClick={reloadVendorFromConflict}
                      disabled={busy}
                    >
                      Reload latest
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={function () {
                        setConflictPrompt(null);
                      }}
                      disabled={busy}
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
                  {busy ? "Saving…" : form.id ? "Update vendor" : "Create vendor"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell
            title="Vendor directory"
            description="Search by name, contact, phone or GST."
          >
            <div className="toolbar">
              <div className="field">
                <label htmlFor="vendors-search-9">Search</label>
                <input
                  id="vendors-search-9"
                  value={search}
                  onChange={function (event: ChangeEvent<HTMLInputElement>) {
                    setSearch(event.target.value);
                  }}
                  placeholder="Name, contact, phone, GST"
                />
              </div>
              <div className="field">
                <label htmlFor="vendors-city-10">City</label>
                <input
                  id="vendors-city-10"
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
            {rows.length >= VENDOR_LIST_CAP ? (
              <p className="mini-muted" style={{ marginBottom: 8 }}>
                Showing first {VENDOR_LIST_CAP} results. Refine search or filters to narrow the list.
              </p>
            ) : null}
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
