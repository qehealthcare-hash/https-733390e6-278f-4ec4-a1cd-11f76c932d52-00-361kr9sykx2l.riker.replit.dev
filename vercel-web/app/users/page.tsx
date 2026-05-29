"use client";

/**
 * Users & roles admin (M11). Canonical roles from `@/business/rbac`.
 */

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  CANONICAL_ROLES,
  ROLE_ADMIN_ROLES,
  USER_ADMIN_ROLES,
  USER_CREATE_ROLES,
  USER_DEACTIVATE_ROLES,
  USER_UPDATE_ROLES
} from "@/business/rbac";

function roleInList(role, list) {
  var normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

function emptyUserForm() {
  return {
    id: "",
    username: "",
    email: "",
    phone: "",
    role: "",
    is_active: true
  };
}

function emptyRoleForm() {
  return {
    id: "",
    name: ""
  };
}

export default function UsersPage() {
  var auth = useAuth();
  var canAdminUsers = roleInList(auth.profile?.role, USER_ADMIN_ROLES);
  var canCreateUser = roleInList(auth.profile?.role, USER_CREATE_ROLES);
  var canUpdateUser = roleInList(auth.profile?.role, USER_UPDATE_ROLES);
  var canDeactivateUser = roleInList(auth.profile?.role, USER_DEACTIVATE_ROLES);
  var canManageRoles = roleInList(auth.profile?.role, ROLE_ADMIN_ROLES);
  var confirm = useConfirm();
  var [users, setUsers] = useState([]);
  var [roles, setRoles] = useState([]);
  var [userForm, setUserForm] = useState(emptyUserForm());
  var [roleForm, setRoleForm] = useState(emptyRoleForm());
  var [search, setSearch] = useState("");
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [busy, setBusy] = useState(false);

  async function reload() {
    if (!auth.session?.access_token) return;
    try {
      var qs = new URLSearchParams();
      qs.set("limit", "500");
      if (search.trim()) qs.set("q", search.trim());
      var [usersResp, rolesResp] = await Promise.all([
        request("/users?" + qs.toString(), null, auth.session),
        request("/roles", null, auth.session)
      ]);
      setUsers(Array.isArray(usersResp?.rows) ? usersResp.rows : []);
      setRoles(Array.isArray(rolesResp?.rows) ? rolesResp.rows : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load users / roles");
    }
  }

  useEffect(
    function () {
      reload();
    },
    [auth.session?.access_token, canAdminUsers]
  );

  var visibleUsers = useMemo(
    function () {
      if (!search.trim()) return users;
      var n = search.trim().toLowerCase();
      return users.filter(function (u) {
        return (
          String(u.username || "").toLowerCase().indexOf(n) >= 0 ||
          String(u.email || "").toLowerCase().indexOf(n) >= 0 ||
          String(u.phone || "").indexOf(n) >= 0
        );
      });
    },
    [users, search]
  );

  function updateUserField(name, value) {
    setUserForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function editUser(row) {
    setUserForm({
      id: row.id,
      username: row.username || "",
      email: row.email || "",
      phone: row.phone || "",
      role: row.role || "",
      is_active: row.is_active !== false
    });
    setError("");
    setMessage("");
  }

  function resetUserForm() {
    setUserForm(emptyUserForm());
  }

  async function submitUser(event) {
    event.preventDefault();
    if (userForm.id ? !canUpdateUser : !canCreateUser) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        userForm.id ? "/users/" + userForm.id : "/users",
        {
          method: userForm.id ? "PATCH" : "POST",
          body: {
            username: userForm.username,
            email: userForm.email,
            phone: userForm.phone,
            role: userForm.role || "",
            is_active: !!userForm.is_active
          }
        },
        auth.session
      );
      setMessage(userForm.id ? "User updated" : "User created");
      resetUserForm();
      await reload();
    } catch (err) {
      setError(err.message || "Could not save user");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateUser(id) {
    if (!canDeactivateUser) return;
    var ok = await confirm({
      title: "Deactivate this user?",
      description: "They will lose access immediately. The account stays in the system for audit history.",
      confirmLabel: "Deactivate",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/users/" + id, { method: "DELETE" }, auth.session);
      if (userForm.id === id) resetUserForm();
      setMessage("User deactivated");
      await reload();
    } catch (err) {
      setError(err.message || "Could not deactivate");
    } finally {
      setBusy(false);
    }
  }

  // ── Roles ──
  // M2-C1: Per-module permission editor was removed because the DB-level
  // `hh_roles.perms` matrix was never consulted at runtime — the CRM is
  // role-based. Editing a role here changes its NAME only; the actual
  // capability list lives in `lib/permissions.js` (frontend) and
  // `lib/api/crmRoles.ts` (server). New roles created here will fall
  // back to STAFF-level capabilities until those code maps are updated.
  function editRole(row) {
    setRoleForm({
      id: row.id,
      name: row.name || ""
    });
    setError("");
    setMessage("");
  }

  function resetRoleForm() {
    setRoleForm(emptyRoleForm());
  }

  async function submitRole(event) {
    event.preventDefault();
    if (!canManageRoles) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        roleForm.id ? "/roles/" + roleForm.id : "/roles",
        {
          method: roleForm.id ? "PATCH" : "POST",
          body: { name: roleForm.name }
        },
        auth.session
      );
      setMessage(roleForm.id ? "Role updated" : "Role created");
      resetRoleForm();
      await reload();
    } catch (err) {
      setError(err.message || "Could not save role");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(id) {
    if (!canManageRoles) return;
    var ok = await confirm({
      title: "Delete this role?",
      description: "The request will fail if any user is currently assigned to it.",
      confirmLabel: "Delete role",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/roles/" + id, { method: "DELETE" }, auth.session);
      if (roleForm.id === id) resetRoleForm();
      setMessage("Role deleted");
      await reload();
    } catch (err) {
      setError(err.message || "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="users.read">
      <AppShell title="Users & roles">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell
              title={userForm.id ? "Edit user" : "Add user"}
              description="Provision CRM access. Email must match Supabase Auth identity."
            >
              {!canCreateUser && !userForm.id ? (
                <div className="helper-box" style={{ marginBottom: 12 }}>
                  Only Admin can create or update users. Managers can view the directory.
                </div>
              ) : null}
              <fieldset
                className="stack"
                disabled={userForm.id ? !canUpdateUser : !canCreateUser}
                style={{ border: 0, margin: 0, padding: 0 }}
              >
              <form className="stack" onSubmit={submitUser}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="users-username-1">Username</label>
                    <input id="users-username-1"
                      value={userForm.username}
                      onChange={function (event) { updateUserField("username", event.target.value); }}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="users-email-2">Email</label>
                    <input id="users-email-2"
                      type="email"
                      value={userForm.email}
                      onChange={function (event) { updateUserField("email", event.target.value); }}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="users-phone-3">Phone</label>
                    <input id="users-phone-3"
                      type="tel"
                      inputMode="tel"
                      value={userForm.phone}
                      onChange={function (event) { updateUserField("phone", event.target.value); }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="users-role-4">Role</label>
                    <select id="users-role-4"
                      value={userForm.role}
                      onChange={function (event) { updateUserField("role", event.target.value); }}
                    >
                      <option value="">No role</option>
                      {/* M2-C2: Canonical labels always render even if the
                          /roles fetch is in-flight; custom rows appended below. */}
                      {CANONICAL_ROLES.map(function (label) {
                        return <option key={label} value={label}>{label}</option>;
                      })}
                      {roles
                        .filter(function (r) { return CANONICAL_ROLES.indexOf(r.name) < 0; })
                        .map(function (r) {
                          return <option key={r.id} value={r.name}>{r.name} (custom)</option>;
                        })
                      }
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="users-input-5">
                      <input id="users-input-5"
                        type="checkbox"
                        checked={!!userForm.is_active}
                        onChange={function (event) { updateUserField("is_active", event.target.checked); }}
                      />
                      &nbsp;Active
                    </label>
                  </div>
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                {message ? <div className="success-text">{message}</div> : null}
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving…" : userForm.id ? "Update user" : "Create user"}
                  </button>
                  <button className="button secondary" type="button" onClick={resetUserForm}>
                    Clear
                  </button>
                </div>
              </form>
              </fieldset>
            </ModuleShell>

            <ModuleShell title="Users" description="Filter by name, email, phone.">
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="users-search-6">Search</label>
                  <input id="users-search-6" value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Username / email / phone" />
                </div>
                <div className="field">
                  <span aria-hidden="true">&nbsp;</span>
                  <button className="button secondary" type="button" onClick={reload}>
                    Refresh
                  </button>
                </div>
              </div>
              {!visibleUsers.length ? (
                <EmptyState title="No users" description="Add a user on the left to populate the directory." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUsers.map(function (u) {
                        return (
                          <tr key={u.id}>
                            <td>{u.username || u.id}</td>
                            <td>{u.email || "-"}</td>
                            <td>{u.phone || "-"}</td>
                            <td>{u.role || "-"}</td>
                            <td>
                              <span className={"status " + (u.is_active === false ? "paused" : "active")}>
                                {u.is_active === false ? "Inactive" : "Active"}
                              </span>
                            </td>
                            <td>
                              <div className="button-row">
                                {canUpdateUser ? (
                                  <button className="button secondary" type="button" onClick={function () { editUser(u); }}>
                                    Edit
                                  </button>
                                ) : null}
                                {canDeactivateUser && u.is_active !== false ? (
                                  <button className="button danger" type="button" onClick={function () { deactivateUser(u.id); }}>
                                    Deactivate
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

          <div className="page-grid">
            <ModuleShell
              title={roleForm.id ? "Edit role" : "Add role"}
              description="Role labels populate the user role dropdown. Capability mapping lives in code (lib/permissions.js + lib/api/crmRoles.ts) — adding a role here does NOT grant new access until those code maps are updated."
            >
              {!canManageRoles ? (
                <div className="helper-box">Only Admin can manage the role catalogue.</div>
              ) : null}
              <fieldset className="stack" disabled={!canManageRoles} style={{ border: 0, margin: 0, padding: 0 }}>
              <form className="stack" onSubmit={submitRole}>
                <div className="field">
                  <label htmlFor="users-role-name-8">Role name</label>
                  <input id="users-role-name-8"
                    value={roleForm.name}
                    onChange={function (event) { setRoleForm({ ...roleForm, name: event.target.value }); }}
                    required
                  />
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving…" : roleForm.id ? "Update role" : "Create role"}
                  </button>
                  <button className="button secondary" type="button" onClick={resetRoleForm}>
                    Clear
                  </button>
                </div>
              </form>
              </fieldset>
            </ModuleShell>

            <ModuleShell title="Roles" description="Catalogue used to populate the user role dropdown.">
              {!roles.length ? (
                <EmptyState title="No roles" description="Add a role on the left." />
              ) : (
                <div className="record-list">
                  {roles.map(function (r) {
                    var isCanonical = CANONICAL_ROLES.indexOf(r.name) >= 0;
                    return (
                      <div className="record-card" key={r.id}>
                        <div className="button-row" style={{ justifyContent: "space-between" }}>
                          <div>
                            <h3>{r.name}{isCanonical ? "" : " (custom)"}</h3>
                            <div className="mini-muted">
                              {isCanonical
                                ? "Capabilities defined in lib/permissions.js + lib/api/crmRoles.ts"
                                : "Users assigned this role fall back to Staff-level access until code maps are updated."}
                            </div>
                          </div>
                          {canManageRoles ? (
                            <div className="button-row">
                              <button className="button secondary" type="button" onClick={function () { editRole(r); }}>
                                Edit
                              </button>
                              <button className="button danger" type="button" onClick={function () { deleteRole(r.id); }}>
                                Delete
                              </button>
                            </div>
                          ) : null}
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
