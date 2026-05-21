import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import { findById, listRows, insertRow, updateRow, deleteRow, resolveClient } from "@/database/baseRepository";
import { runQuery, runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_attendance";
const SCOPE = "attendanceRepository";

export interface AttendanceListFilters extends ListQuery {
  employeeId?: string;
  dutyId?: string;
  status?: string;
  from?: string;
  to?: string;
}

export const attendanceRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  findByDutyId(dutyId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from(TABLE).select("id").eq("duty_id", dutyId).maybeSingle(),
      `${SCOPE}.findByDutyId`
    );
  },

  list(filters: AttendanceListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
        if (filters.dutyId) query = query.eq("duty_id", filters.dutyId);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.from) query = query.gte("check_in_at", filters.from);
        if (filters.to) query = query.lte("check_in_at", filters.to);
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "check_in_at", ascending: filters.ascending ?? false }
    );
  },

  listByMonth(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("employee_id, status, hours, check_in_at")
          .gte("check_in_at", startISO)
          .lt("check_in_at", endISO),
      `${SCOPE}.listByMonth`
    );
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
