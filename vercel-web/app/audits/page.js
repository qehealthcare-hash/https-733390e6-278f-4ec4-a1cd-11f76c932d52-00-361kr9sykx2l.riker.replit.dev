"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";
import { formatDate } from "@/lib/formatters";
import { downloadCsv } from "@/lib/csv";

export default function AuditsPage() {
  var auth = useAuth();
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState("");
  var [moduleFilter, setModuleFilter] = useState("");
  var [entityFilter, setEntityFilter] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      var path = "/audits?limit=200";
      if (moduleFilter) path += "&module=" + encodeURIComponent(moduleFilter);
      if (entityFilter) path += "&entity_id=" + encodeURIComponent(entityFilter);
      setLoading(true);
      request(path, null, auth.session)
        .then(function (data) {
          setRows((data && data.rows) || []);
          setError("");
        })
        .catch(function (err) {
          setError(err.message || "Unable to load audit log");
          setRows([]);
        })
        .finally(function () {
          setLoading(false);
        });
    },
    [auth.session, moduleFilter, entityFilter]
  );

  var modules = useMemo(
    function () {
      var set = {};
      rows.forEach(function (row) {
        if (row.module) set[row.module] = true;
      });
      return Object.keys(set).sort();
    },
    [rows]
  );

  return (
    <AuthGuard permission="audits.read">
      <AppShell title="Audit log">
        <div className="page-grid">
          <ModuleShell
            title="Mutation trail"
            description="Append-only log written by /api/v1 services on every create, update, and delete"
            actions={
              <button
                className="button secondary"
                type="button"
                onClick={function () {
                  downloadCsv(
                    "audit-log.csv",
                    rows.map(function (row) {
                      return {
                        id: row.id,
                        module: row.module,
                        entity_id: row.entity_id,
                        action: row.action,
                        actor: row.actor,
                        stamp: row.stamp,
                        created_at: row.created_at
                      };
                    })
                  );
                }}
              >
                Export CSV
              </button>
            }
          >
            <div className="toolbar">
              <div className="field">
                <label>Module</label>
                <select
                  value={moduleFilter}
                  onChange={function (event) {
                    setModuleFilter(event.target.value);
                  }}
                >
                  <option value="">All modules</option>
                  {modules.map(function (mod) {
                    return (
                      <option key={mod} value={mod}>
                        {mod}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label>Entity ID</label>
                <input
                  value={entityFilter}
                  onChange={function (event) {
                    setEntityFilter(event.target.value);
                  }}
                  placeholder="PID000001, INQ00001, …"
                />
              </div>
            </div>
            {error ? <div className="error-text">{error}</div> : null}
            {!rows.length ? (
              <EmptyState
                title={loading ? "Loading audit entries…" : "No audit entries"}
                description="Mutations through the API layer record an audit row before returning success (unless API_AUDIT_DISABLED is set)."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Module</th>
                      <th>Entity</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Stamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(function (row) {
                      return (
                        <tr key={row.id}>
                          <td>{formatDate(row.created_at)}</td>
                          <td>{row.module}</td>
                          <td className="td-id">{row.entity_id || "—"}</td>
                          <td>{row.action}</td>
                          <td>{row.actor}</td>
                          <td>{row.stamp}</td>
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
