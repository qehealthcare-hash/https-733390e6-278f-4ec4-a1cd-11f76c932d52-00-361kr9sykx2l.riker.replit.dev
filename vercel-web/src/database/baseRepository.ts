/**
 * Shared database primitives used by all repositories.
 * No domain rules — only PostgREST access patterns.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, userClient, runQuery, runListQuery } from "@/database/supabaseClient";
import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult, MonthRange } from "@/database/types";

/** PostgREST chain after `.select()` — typed loosely to avoid SDK generic churn. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbFilterQuery = any;

export function resolveClient(opts?: DbAccess): SupabaseClient {
  if (opts?.accessToken) return userClient(opts.accessToken);
  return adminClient();
}

/** Build YYYY-MM month window in UTC. */
export function monthRange(month?: string): MonthRange {
  const m = (month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
    return monthRange(`${y}-${mo}`);
  }
  const [y, mo] = m.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { period: m, startISO: start.toISOString(), endISO: end.toISOString() };
}

export async function findById(
  table: string,
  id: string,
  scope: string,
  opts?: DbAccess,
  select = "*"
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(
    () => db.from(table).select(select).eq("id", id).maybeSingle(),
    `${scope}.findById`
  );
}

export async function findOneBy(
  table: string,
  column: string,
  value: string,
  scope: string,
  opts?: DbAccess,
  select = "*"
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(
    () => db.from(table).select(select).eq(column, value).maybeSingle(),
    `${scope}.findOneBy`
  );
}

export async function listRows(
  table: string,
  scope: string,
  build: (q: DbFilterQuery) => DbFilterQuery,
  opts?: DbAccess & ListQuery
): Promise<ApiResult<ListResult<JsonRow>>> {
  const db = resolveClient(opts);
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const orderBy = opts?.orderBy ?? "created_at";
  const ascending = opts?.ascending ?? false;
  const select = opts?.select ?? "*";

  let query: DbFilterQuery = db.from(table).select(select, { count: "exact" });
  query = build(query);
  query = query.order(orderBy, { ascending }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    return {
      success: false,
      error: error.message,
      code: "database_error",
      details: { scope, code: error.code }
    };
  }
  const rows = (data as JsonRow[] | null) || [];
  return {
    success: true,
    data: { rows, total: count ?? rows.length }
  };
}

export async function insertRow(
  table: string,
  row: JsonRow,
  scope: string,
  opts?: DbAccess
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(() => db.from(table).insert(row).select("*").single(), `${scope}.insert`);
}

export async function updateRow(
  table: string,
  id: string,
  patch: JsonRow,
  scope: string,
  opts?: DbAccess
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(
    () => db.from(table).update(patch).eq("id", id).select("*").single(),
    `${scope}.update`
  );
}

export async function updateRowBy(
  table: string,
  column: string,
  value: string,
  patch: JsonRow,
  scope: string,
  opts?: DbAccess
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(
    () => db.from(table).update(patch).eq(column, value).select("*").maybeSingle(),
    `${scope}.updateBy`
  );
}

export async function deleteRow(
  table: string,
  id: string,
  scope: string,
  opts?: DbAccess
): Promise<ApiResult<null>> {
  const db = resolveClient(opts);
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) {
    return {
      success: false,
      error: error.message,
      code: "database_error",
      details: { scope, code: error.code }
    };
  }
  return { success: true, data: null };
}

export async function upsertRow(
  table: string,
  row: JsonRow,
  scope: string,
  opts?: DbAccess,
  onConflict = "id"
): Promise<ApiResult<JsonRow | null>> {
  const db = resolveClient(opts);
  return runQuery(
    () => db.from(table).upsert(row, { onConflict }).select("*").single(),
    `${scope}.upsert`
  );
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  scope: string,
  opts?: DbAccess
): Promise<ApiResult<T | null>> {
  const db = resolveClient(opts);
  return runQuery(() => db.rpc(fn, args), `${scope}.rpc.${fn}`);
}

/** Head-only count query. */
export async function countWhere(
  table: string,
  scope: string,
  build: (q: DbFilterQuery) => DbFilterQuery,
  opts?: DbAccess
): Promise<ApiResult<number>> {
  const db = resolveClient(opts);
  let query: DbFilterQuery = db.from(table).select("id", { count: "exact", head: true });
  query = build(query);
  const { count, error } = await query;
  if (error) {
    return {
      success: false,
      error: error.message,
      code: "database_error",
      details: { scope, code: error.code }
    };
  }
  return { success: true, data: count ?? 0 };
}

export async function listAll(
  table: string,
  scope: string,
  build: (q: DbFilterQuery) => DbFilterQuery,
  opts?: DbAccess & { orderBy?: string; ascending?: boolean; select?: string }
): Promise<ApiResult<JsonRow[]>> {
  const db = resolveClient(opts);
  const orderBy = opts?.orderBy ?? "created_at";
  const ascending = opts?.ascending ?? false;
  const select = opts?.select ?? "*";
  let query: DbFilterQuery = db.from(table).select(select);
  query = build(query);
  query = query.order(orderBy, { ascending });
  return runListQuery(async () => {
    const { data, error } = await query;
    return { data: (data as JsonRow[] | null) || [], error };
  }, `${scope}.listAll`);
}
