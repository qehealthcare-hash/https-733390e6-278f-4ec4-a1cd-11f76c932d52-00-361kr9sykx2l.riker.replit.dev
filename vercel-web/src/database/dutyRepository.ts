import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_duties";
const SCOPE = "dutyRepository";

export interface DutyListFilters extends ListQuery {
  q?: string;
  employeeId?: string;
  patientId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export const dutyRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: DutyListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
        if (filters.patientId) query = query.eq("patient_id", filters.patientId);
        if (filters.from) query = query.gte("start_at", filters.from);
        if (filters.to) query = query.lte("end_at", filters.to);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["service_type", "shift_type", "status", "notes"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "start_at", ascending: filters.ascending ?? false }
    );
  },

  /** Overlapping duties for same employee (excludes CANCELLED / NO_SHOW). */
  async findOverlapping(
    employeeId: string,
    startAt: string,
    endAt: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const result = await runListQuery(
      () =>
        db
          .from(TABLE)
          .select("id, employee_id, start_at, end_at, status")
          .eq("employee_id", employeeId)
          .not("status", "in", "(CANCELLED,NO_SHOW)")
          .lt("start_at", endAt)
          .gt("end_at", startAt),
      `${SCOPE}.findOverlapping`
    );
    if (!result.success) return result;
    const rows = (result.data || []).filter((r) => !excludeId || String(r.id) !== excludeId);
    return { success: true, data: rows };
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
