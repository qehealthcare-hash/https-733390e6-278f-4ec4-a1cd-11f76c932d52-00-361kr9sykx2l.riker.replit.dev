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
import { sanitizeSearchTerm } from "@/lib/api/security";

const USERS = "hh_users";
const ROLES = "hh_roles";

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
    return runQuery(
      () => db.from(USERS).select("id, email").ilike("email", email).maybeSingle(),
      "user.findByEmail"
    );
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
};
