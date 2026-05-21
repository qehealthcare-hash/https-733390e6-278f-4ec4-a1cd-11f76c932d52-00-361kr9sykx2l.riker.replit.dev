import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import { findById, listRows, insertRow, updateRow, deleteRow, resolveClient } from "@/database/baseRepository";
import { runQuery } from "@/database/supabaseClient";

const TABLE = "hh_inquiries";
const SCOPE = "inquiryRepository";

export interface InquiryListFilters extends ListQuery {
  q?: string;
  status?: string;
  assigned_to?: string;
}

export const inquiryRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: InquiryListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["name", "phone", "city", "area", "service", "source"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  async findByPhone(phone: string, excludeId?: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    if (!normalized) return { success: true, data: null };
    const db = resolveClient(opts);
    return runQuery(async () => {
      const { data, error } = await db.from(TABLE).select("id, name, phone, status").eq("phone", normalized).maybeSingle();
      if (error) return { data: null, error };
      if (data && excludeId && String(data.id) === excludeId) return { data: null, error: null };
      return { data, error: null };
    }, `${SCOPE}.findByPhone`);
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, SCOPE, opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, SCOPE, opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, SCOPE, opts);
  }
};
