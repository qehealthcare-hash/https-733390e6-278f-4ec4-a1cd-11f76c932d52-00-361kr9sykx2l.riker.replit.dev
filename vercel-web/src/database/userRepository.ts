/**
 * User / role repository — Supabase access for `hh_users` and `hh_roles`.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListResult } from "@/database/types";
import {
  deleteRow,
  findById as baseFindById,
  insertRow,
  listRows,
  resolveClient,
  updateRow
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";
import { adminClient } from "@/database/clients";
import { sanitizeSearchTerm } from "@/utils/searchTerm";

const USERS = "hh_users";
const ROLES = "hh_roles";

export interface ResolvedActorRow {
  userId: string;
  email: string;
  username: string;
  role: string;
}

export interface UserListQuery extends DbAccess {
  q?: string;
  role?: string;
  active?: "true" | "false" | string;
  limit?: number;
  offset?: number;
}

export const userRepository = {
  list(opts: UserListQuery): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      USERS,
      "user",
      (q) => {
        let chain = q;
        if (opts.q) {
          const term = sanitizeSearchTerm(opts.q);
          if (term) {
            chain = chain.or(
              `username.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`
            );
          }
        }
        if (opts.role) chain = chain.eq("role", opts.role);
        if (opts.active === "true") chain = chain.eq("is_active", true);
        if (opts.active === "false") chain = chain.eq("is_active", false);
        return chain;
      },
      {
        accessToken: opts.accessToken,
        limit: opts.limit ?? 200,
        offset: opts.offset ?? 0,
        orderBy: "username",
        ascending: true
      }
    );
  },

  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return baseFindById(USERS, id, "user", opts);
  },

  async findByUsername(
    username: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from(USERS).select("id, username").ilike("username", username).maybeSingle(),
      "user.findByUsername"
    );
  },

  async findByEmail(email: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    // P1-37: normalize on read; emails are stored in lowercase form.
    const normalized = String(email || "").toLowerCase();
    return runQuery(
      () => db.from(USERS).select("id, email").eq("email", normalized).maybeSingle(),
      "user.findByEmail"
    );
  },

  /**
   * Translate a CRM username or email into the Supabase Auth email used at login.
   * Tries the service-role RPC first, then falls back to a direct hh_users read.
   */
  async resolveLoginEmail(loginInput: string): Promise<ApiResult<string | null>> {
    const needle = String(loginInput || "").trim();
    if (!needle) return { success: true, data: null };
    if (needle.includes("@")) {
      return { success: true, data: needle.toLowerCase() };
    }
    const admin = adminClient();
    const rpc = await runQuery<string | null>(
      () => admin.rpc("_hh_resolve_login_email", { login_input: needle }),
      "user.resolveLoginEmail.rpc"
    );
    if (rpc.success && typeof rpc.data === "string" && rpc.data.trim()) {
      return { success: true, data: rpc.data.trim().toLowerCase() };
    }
    const byUsername = await runQuery<JsonRow | null>(
      () =>
        admin
          .from(USERS)
          .select("email")
          .eq("is_active", true)
          .ilike("username", needle)
          .limit(1)
          .maybeSingle(),
      "user.resolveLoginEmail.byUsername"
    );
    if (byUsername.success && byUsername.data?.email) {
      return {
        success: true,
        data: String(byUsername.data.email).trim().toLowerCase() || null
      };
    }
    const byEmail = await runQuery<JsonRow | null>(
      () =>
        admin
          .from(USERS)
          .select("email")
          .eq("is_active", true)
          .ilike("email", needle)
          .limit(1)
          .maybeSingle(),
      "user.resolveLoginEmail.byEmail"
    );
    if (byEmail.success && byEmail.data?.email) {
      return {
        success: true,
        data: String(byEmail.data.email).trim().toLowerCase() || null
      };
    }
    return { success: true, data: null };
  },

  async listForSequence(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(USERS).select("id").order("id", { ascending: false }).limit(500),
      "user.listForSequence"
    );
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(USERS, row, "user", opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(USERS, id, patch, "user", opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(USERS, id, "user", opts);
  },

  /**
   * Resolve a Supabase JWT to an active `hh_users` row (used by `requireActor`).
   */
  async resolveActorFromToken(accessToken: string): Promise<ApiResult<ResolvedActorRow | null>> {
    const admin = adminClient();
    const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return { success: false, error: userErr?.message || "Invalid session", code: "unauthorized" };
    }

    const email = (userData.user.email || "").toLowerCase();
    if (!email) {
      return { success: false, error: "Session has no email", code: "unauthorized" };
    }

    const appUser = await runQuery<JsonRow | null>(
      () =>
        admin
          .from(USERS)
          .select("id, username, email, role, is_active")
          // P1-37: case-insensitive match by normalizing the input first.
          // .ilike on email caused Supabase to fall back to a sequential
          // scan and (worse) matched partial patterns when callers
          // accidentally passed user-controlled strings — `.eq` with the
          // already-lowercased value is exact + index-friendly.
          .eq("email", email.toLowerCase())
          .eq("is_active", true)
          .maybeSingle(),
      "user.resolveActorFromToken.hh_users"
    );
    if (!appUser.success) {
      return { success: false, error: appUser.error, code: appUser.code, details: appUser.details };
    }
    if (!appUser.data) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        userId: String(appUser.data.id),
        email,
        username: String(appUser.data.username || email),
        role: String(appUser.data.role || "Staff")
      }
    };
  }
};

/* --------------------------------- Roles --------------------------------- */

export const roleRepository = {
  async listAll(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(ROLES).select("*").order("name"),
      "role.listAll"
    );
  },

  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return baseFindById(ROLES, id, "role", opts);
  },

  async findByName(name: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from(ROLES).select("id, name").ilike("name", name).maybeSingle(),
      "role.findByName"
    );
  },

  async listForSequence(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(ROLES).select("id, name").order("id", { ascending: false }).limit(500),
      "role.listForSequence"
    );
  },

  async countUsersForRole(id: string, opts?: DbAccess): Promise<ApiResult<number>> {
    const db = resolveClient(opts);
    const result = await runQuery<number>(async () => {
      const { count, error } = await db
        .from(USERS)
        .select("id", { count: "exact", head: true })
        .eq("role", id);
      return { data: count ?? 0, error };
    }, "role.countUsers");
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: result.data ?? 0 };
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(ROLES, row, "role", opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(ROLES, id, patch, "role", opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(ROLES, id, "role", opts);
  }
  // M2-C1: `listPermissionsForRoleName` was deleted with `parseRolePerms`.
  // The CRM is role-based; the `hh_roles.perms` column is preserved on
  // disk for audit / future use but never read at runtime.
};
