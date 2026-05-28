"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";

var KNOWN_KEYS = [
  { key: "signatoryName", label: "Signatory name" },
  { key: "signatoryTitle", label: "Signatory title" },
  { key: "signature", label: "Signature image URL" },
  { key: "seal", label: "Company seal image URL" },
  { key: "services", label: "Service catalogue (JSON array)", textarea: true, json: true },
  { key: "shiftRates", label: "Shift rates (JSON, e.g. {\"DAY\":700,\"NIGHT\":900})", textarea: true, json: true },
  { key: "company", label: "Company info (JSON)", textarea: true, json: true }
];

function valueToString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

function parseValue(input, isJson) {
  if (input === "") return null;
  if (!isJson) return input;
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new Error("Value for this key must be valid JSON");
  }
}

export default function SettingsPage() {
  var auth = useAuth();
  var confirm = useConfirm();
  var [settings, setSettings] = useState({});
  var [drafts, setDrafts] = useState({});
  var [customKey, setCustomKey] = useState("");
  var [customValue, setCustomValue] = useState("");
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [busy, setBusy] = useState(false);
  var [loading, setLoading] = useState(true);

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var data = await request("/settings", null, auth.session);
      setSettings(data || {});
      var initialDrafts = {};
      KNOWN_KEYS.forEach(function (k) {
        initialDrafts[k.key] = valueToString(data ? data[k.key] : null);
      });
      Object.keys(data || {}).forEach(function (k) {
        if (!(k in initialDrafts)) initialDrafts[k] = valueToString(data[k]);
      });
      setDrafts(initialDrafts);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load settings");
      setSettings({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(
    function () {
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session]
  );

  async function saveKey(keyDef) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var raw = drafts[keyDef.key] !== undefined ? drafts[keyDef.key] : "";
      var value = parseValue(raw, keyDef.json);
      await requestWithOfflineFallback(
        "/settings/" + encodeURIComponent(keyDef.key),
        { method: "PUT", body: { value: value } },
        auth.session
      );
      setMessage("Saved " + keyDef.key);
      await reload();
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function deleteKey(key) {
    var ok = await confirm({
      title: "Delete setting '" + key + "'?",
      description: "Removing a setting may affect downstream modules until it is restored.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/settings/" + encodeURIComponent(key), { method: "DELETE" }, auth.session);
      setMessage("Deleted " + key);
      await reload();
    } catch (err) {
      setError(err.message || "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  async function addCustom() {
    if (!customKey.trim()) {
      setError("Custom key is required");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var raw = customValue.trim();
      var parsed;
      try {
        parsed = raw && raw.startsWith("{") ? JSON.parse(raw) : raw;
      } catch (err) {
        parsed = raw;
      }
      await requestWithOfflineFallback(
        "/settings/" + encodeURIComponent(customKey.trim()),
        { method: "PUT", body: { value: parsed } },
        auth.session
      );
      setMessage("Saved " + customKey);
      setCustomKey("");
      setCustomValue("");
      await reload();
    } catch (err) {
      setError(err.message || "Could not save custom setting");
    } finally {
      setBusy(false);
    }
  }

  var customKeys = Object.keys(settings).filter(function (k) {
    return !KNOWN_KEYS.some(function (def) {
      return def.key === k;
    });
  });

  return (
    <AuthGuard permission="settings.read">
      <AppShell title="Settings">
        <div className="page-split">
          <ModuleShell title="App settings" description="Branding, signatures, services and rate config. All changes audited.">
            {loading ? (
              <EmptyState title="Loading…" description="Fetching settings from hh_app_settings." />
            ) : (
              <div className="stack">
                {KNOWN_KEYS.map(function (def) {
                  return (
                    <div className="field" key={def.key}>
                      <label htmlFor="settings-codedef-keycode-def-labe-1">
                        <code>{def.key}</code> — {def.label}
                      </label>
                      {def.textarea ? (
                        <textarea id="settings-codedef-keycode-def-labe-1"
                          rows="4"
                          value={drafts[def.key] || ""}
                          onChange={function (event) {
                            setDrafts(Object.assign({}, drafts, { [def.key]: event.target.value }));
                          }}
                        />
                      ) : (
                        <input
                          value={drafts[def.key] || ""}
                          onChange={function (event) {
                            setDrafts(Object.assign({}, drafts, { [def.key]: event.target.value }));
                          }}
                        />
                      )}
                      <div className="button-row" style={{ marginTop: 4 }}>
                        <button className="button primary" type="button" onClick={function () { saveKey(def); }} disabled={busy}>
                          Save
                        </button>
                        {settings[def.key] !== undefined ? (
                          <button
                            className="button danger"
                            type="button"
                            onClick={function () { deleteKey(def.key); }}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {error ? <div className="error-text">{error}</div> : null}
            {message ? <div className="success-text">{message}</div> : null}
          </ModuleShell>

          <ModuleShell title="Custom settings" description="Add any key/value not in the standard list.">
            <form
              className="stack"
              onSubmit={function (event) {
                event.preventDefault();
                addCustom();
              }}
            >
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="settings-key-2">Key</label>
                  <input id="settings-key-2"
                    value={customKey}
                    onChange={function (event) { setCustomKey(event.target.value); }}
                    placeholder="e.g. invoicePrefix"
                  />
                </div>
                <div className="field">
                  <label htmlFor="settings-value-string-or-json-3">Value (string or JSON)</label>
                  <input id="settings-value-string-or-json-3"
                    value={customValue}
                    onChange={function (event) { setCustomValue(event.target.value); }}
                    placeholder='"INV-" or {"foo":1}'
                  />
                </div>
              </div>
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  Save custom
                </button>
              </div>
            </form>
            {customKeys.length ? (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <strong>Existing custom keys</strong>
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customKeys.map(function (k) {
                      return (
                        <tr key={k}>
                          <td><code>{k}</code></td>
                          <td>
                            <code className="mini-muted">{valueToString(settings[k]).slice(0, 120)}</code>
                          </td>
                          <td>
                            <button className="button danger" type="button" onClick={function () { deleteKey(k); }} disabled={busy}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </ModuleShell>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
