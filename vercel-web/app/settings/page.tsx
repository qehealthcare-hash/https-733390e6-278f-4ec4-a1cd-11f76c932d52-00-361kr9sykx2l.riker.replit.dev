"use client";

/**
 * App settings (M11 Pass D). Helpers: `@/lib/settingsUi`.
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  SETTINGS_DELETE_ROLES,
  SETTINGS_READ_ROLES,
  SETTINGS_WRITE_ROLES
} from "@/business/rbac";
import {
  SETTINGS_KNOWN_KEYS,
  parseSettingsValue,
  settingsValueToString
} from "@/lib/settingsUi";

function roleInList(role, list) {
  const normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

export default function SettingsPage() {
  const auth = useAuth();
  const canRead = roleInList(auth.profile?.role, SETTINGS_READ_ROLES);
  const canWrite = roleInList(auth.profile?.role, SETTINGS_WRITE_ROLES);
  const canDelete = roleInList(auth.profile?.role, SETTINGS_DELETE_ROLES);
  const confirm = useConfirm();
  const [settings, setSettings] = useState({});
  const [drafts, setDrafts] = useState({});
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  const toast = useToast();
  const setError = useCallback(function (msg) {
    const text = String(msg || "");
    setErrorState(text);
    if (text) toast.error(text);
  }, [toast]);
  const setMessage = useCallback(function (msg) {
    const text = String(msg || "");
    setMessageState(text);
    if (text) toast.success(text);
  }, [toast]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!auth.session?.access_token || !canRead) return;
    setLoading(true);
    try {
      const data = await request("/settings", null, auth.session);
      setSettings(data || {});
      const initialDrafts = {};
      SETTINGS_KNOWN_KEYS.forEach(function (k) {
        initialDrafts[k.key] = settingsValueToString(data ? data[k.key] : null);
      });
      Object.keys(data || {}).forEach(function (k) {
        if (!(k in initialDrafts)) initialDrafts[k] = settingsValueToString(data[k]);
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
    [auth.session?.access_token, canRead]
  );

  async function saveKey(keyDef) {
    if (!canWrite) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const raw = drafts[keyDef.key] !== undefined ? drafts[keyDef.key] : "";
      const value = parseSettingsValue(raw, !!keyDef.json);
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
    if (!canDelete) return;
    const ok = await confirm({
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
    if (!canWrite) return;
    if (!customKey.trim()) {
      setError("Custom key is required");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const raw = customValue.trim();
      let parsed;
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

  const customKeys = Object.keys(settings).filter(function (k) {
    return !SETTINGS_KNOWN_KEYS.some(function (def) {
      return def.key === k;
    });
  });

  return (
    <AuthGuard permission="settings.read">
      <AppShell title="Settings">
        <div className="page-split">
          <ModuleShell title="App settings" description="Branding, signatures, services and rate config. All changes audited.">
            {!canWrite ? (
              <div className="helper-box" style={{ marginBottom: 12 }}>
                Read-only — only Admin and Manager can change settings. Accountant can view values.
              </div>
            ) : null}
            {loading ? (
              <EmptyState title="Loading…" description="Fetching settings from hh_app_settings." />
            ) : (
              <fieldset className="stack" disabled={!canWrite} style={{ border: 0, margin: 0, padding: 0 }}>
                {SETTINGS_KNOWN_KEYS.map(function (def) {
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
                        {canWrite ? (
                          <button className="button primary" type="button" onClick={function () { saveKey(def); }} disabled={busy}>
                            Save
                          </button>
                        ) : null}
                        {canDelete && settings[def.key] !== undefined ? (
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
              </fieldset>
            )}
            <ErrorBanner message={error} />
            <SuccessBanner message={message} />
          </ModuleShell>

          <ModuleShell title="Custom settings" description="Add any key/value not in the standard list.">
            <fieldset className="stack" disabled={!canWrite} style={{ border: 0, margin: 0, padding: 0 }}>
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
            </fieldset>
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
                            <code className="mini-muted">{settingsValueToString(settings[k]).slice(0, 120)}</code>
                          </td>
                          <td>
                            {canDelete ? (
                              <button className="button danger" type="button" onClick={function () { deleteKey(k); }} disabled={busy}>
                                Delete
                              </button>
                            ) : null}
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
