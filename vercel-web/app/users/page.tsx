"use client";

/**
 * Users & roles admin (M11). Canonical roles from `@/business/rbac`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { rolesClient, usersClient } from "@/lib/clients";
import { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  CANONICAL_ROLES,
  ROLE_ADMIN_ROLES,
  USER_CREATE_ROLES,
  USER_DEACTIVATE_ROLES,
  USER_UPDATE_ROLES
} from "@/business/rbac";

type UsersAuth = {
  session?: { access_token?: string } | null;
  profile?: { role?: string } | null;
};

interface AppUserRow {
  id: string;
  updated_at?: string | null;
  username?: string;
  email?: string;
  phone?: string;
  role?: string;
  is_active?: boolean;
}

interface AppRoleRow {
  id: string;
  name?: string;
}

interface UserFormState {
  id: string;
  expected_updated_at: string;
  username: string;
  email: string;
  phone: string;
  role: string;
  is_active: boolean;
}

function catalogExpectedUpdatedAt(row: { updated_at?: string | null }): string {
  return row.updated_at ? String(row.updated_at) : "";
}

interface RoleFormState {
  id: string;
  name: string;
}

type ListEnvelope<T> = {
  rows?: T[];
};

const USER_LIST_CAP = 500;

function roleInList(role: string | undefined | null, list: readonly string[]): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

function emptyUserForm(): UserFormState {
  return {
    id: "",
    expected_updated_at: "",
    username: "",
    email: "",
    phone: "",
    role: "",
    is_active: true
  };
}

function emptyRoleForm(): RoleFormState {
  return {
    id: "",
    name: ""
  };
}

export default function UsersPage() {
  const auth = useAuth() as unknown as UsersAuth;
  const canCreateUser = roleInList(auth.profile?.role, USER_CREATE_ROLES);
  const canUpdateUser = roleInList(auth.profile?.role, USER_UPDATE_ROLES);
  const canDeactivateUser = roleInList(auth.profile?.role, USER_DEACTIVATE_ROLES);
  const canManageRoles = roleInList(auth.profile?.role, ROLE_ADMIN_ROLES);
  const confirm = useConfirm();
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [roles, setRoles] = useState<AppRoleRow[]>([]);
  const [userForm, setUserForm] = useState(emptyUserForm());
  const [roleForm, setRoleForm] = useState(emptyRoleForm());
  const [search, setSearch] = useState("");
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  const [conflictPrompt, setConflictPrompt] = useState<{
    message: string;
    actual?: string;
  } | null>(null);
  const toast = useToast();
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
  const [busy, setBusy] = useState(false);
  const accessToken = auth.session?.access_token ?? "";
  const sessionRef = useRef(auth.session);
  sessionRef.current = auth.session;
  const searchRef = useRef(search);
  searchRef.current = search;

  const reload = useCallback(
    async function () {
      const session = sessionRef.current;
      if (!accessToken || !session) return;
      try {
        const [usersResp, rolesResp] = await Promise.all([
          usersClient.list(session, {
            limit: USER_LIST_CAP,
            q: searchRef.current.trim() || undefined
          }) as Promise<ListEnvelope<AppUserRow>>,
          rolesClient.list(session) as Promise<ListEnvelope<AppRoleRow>>
        ]);
        setUsers(Array.isArray(usersResp?.rows) ? usersResp.rows : []);
        setRoles(Array.isArray(rolesResp?.rows) ? rolesResp.rows : []);
        setError("");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load users / roles");
      }
    },
    [accessToken, setError]
  );

  useEffect(
    function () {
      void reload();
    },
    [reload]
  );

  const visibleUsers = useMemo(
    function () {
      if (!search.trim()) return users;
      const n = search.trim().toLowerCase();
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

  function updateUserField(name: keyof UserFormState, value: string | boolean) {
    setUserForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function editUser(row: AppUserRow) {
    setConflictPrompt(null);
    setUserForm({
      id: row.id,
      expected_updated_at: catalogExpectedUpdatedAt(row),
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
    setConflictPrompt(null);
  }

  async function reloadUserFromConflict() {
    if (!auth.session || !userForm.id) return;
    setBusy(true);
    setError("");
    try {
      const row = (await usersClient.get(auth.session, userForm.id)) as AppUserRow;
      editUser(row);
      setMessage("Reloaded latest user record");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Could not reload user"));
    } finally {
      setBusy(false);
    }
  }

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userForm.id ? !canUpdateUser : !canCreateUser) return;
    setBusy(true);
    setError("");
    setMessage("");
    setConflictPrompt(null);
    try {
      const body: Record<string, unknown> = {
        username: userForm.username,
        email: userForm.email,
        phone: userForm.phone,
        role: userForm.role || "",
        is_active: !!userForm.is_active
      };
      if (userForm.id && userForm.expected_updated_at) {
        body.expected_updated_at = userForm.expected_updated_at;
      }
      await usersClient.save(auth.session, userForm.id || undefined, body);
      setMessage(userForm.id ? "User updated" : "User created");
      resetUserForm();
      await reload();
    } catch (err: unknown) {
      if (isApiConflictError(err)) {
        const details = (err as { details?: { actual_updated_at?: string } }).details;
        setConflictPrompt({
          message: apiErrorMessage(err, "User was modified by another user — reload and try again."),
          actual: details?.actual_updated_at
        });
      } else {
        setError(apiErrorMessage(err, "Could not save user"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function deactivateUser(id: string) {
    if (!canDeactivateUser) return;
    const ok = await confirm({
      title: "Deactivate this user?",
      description: "They will lose access immediately. The account stays in the system for audit history.",
      confirmLabel: "Deactivate",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await usersClient.deactivate(auth.session, id);
      if (userForm.id === id) resetUserForm();
      setMessage("User deactivated");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not deactivate");
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
  function editRole(row: AppRoleRow) {
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

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageRoles) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await rolesClient.save(auth.session, roleForm.id || undefined, { name: roleForm.name });
      setMessage(roleForm.id ? "Role updated" : "Role created");
      resetRoleForm();
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save role");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(id: string) {
    if (!canManageRoles) return;
    const ok = await confirm({
      title: "Delete this role?",
      description: "The request will fail if any user is currently assigned to it.",
      confirmLabel: "Delete role",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await rolesClient.remove(auth.session, id);
      if (roleForm.id === id) resetRoleForm();
      setMessage("Role deleted");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete");
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
                        .filter(function (r) {
                          return (
                            (CANONICAL_ROLES as readonly string[]).indexOf(
                              String(r.name || "")
                            ) < 0
                          );
                        })
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
                        onClick={reloadUserFromConflict}
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
              {users.length >= USER_LIST_CAP ? (
                <p className="mini-muted" style={{ marginBottom: 8 }}>
                  Showing first {USER_LIST_CAP} results. Refine search to narrow the list.
                </p>
              ) : null}
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
                    const isCanonical = (CANONICAL_ROLES as readonly string[]).includes(
                      String(r.name || "")
                    );
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
