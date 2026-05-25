import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  resolveClient,
  listAll
} from "@/database/baseRepository";
import { runQuery, runListQuery } from "@/database/supabaseClient";
import { crmDayEndIso, crmDayStartIso } from "@/utils/crmToday";

const TABLE = "hh_attendance";
const SCOPE = "attendanceRepository";

export interface AttendanceListFilters extends ListQuery {
  q?: string;
  employeeId?: string;
  dutyId?: string;
  patientId?: string;
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
      () => db.from(TABLE).select("*").eq("duty_id", dutyId).maybeSingle(),
      `${SCOPE}.findByDutyId`
    );
  },

  findByDutyAndEmployee(
    dutyId: string,
    employeeId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("duty_id", dutyId)
          .eq("employee_id", employeeId)
          .maybeSingle(),
      `${SCOPE}.findByDutyAndEmployee`
    );
  },

  /**
   * Candidate rows for duplicate detection: same employee on a given calendar
   * date (UTC). Used when `duty_id` isn't set.
   */
  async findByEmployeeAndDate(
    employeeId: string,
    dateKey: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const start = crmDayStartIso(dateKey);
    const end = crmDayEndIso(dateKey);
    const db = resolveClient(opts);
    const timed = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("employee_id", employeeId)
          .gte("check_in_at", start)
          .lte("check_in_at", end),
      `${SCOPE}.findByEmployeeAndDate.timed`
    );
    if (!timed.success) return timed;
    const noTime = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("employee_id", employeeId)
          .eq("work_date", dateKey),
      `${SCOPE}.findByEmployeeAndDate.noTime`
    );
    if (!noTime.success) return noTime;
    const seen = new Set<string>();
    const merged: JsonRow[] = [];
    for (const row of [...(timed.data || []), ...(noTime.data || [])]) {
      const id = String(row.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    return { success: true, data: merged };
  },

  list(filters: AttendanceListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
        if (filters.dutyId) query = query.eq("duty_id", filters.dutyId);
        if (filters.patientId) query = query.eq("patient_id", filters.patientId);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.from) {
          query = query.gte("check_in_at", crmDayStartIso(filters.from.slice(0, 10)));
        }
        if (filters.to) {
          query = query.lte("check_in_at", crmDayEndIso(filters.to.slice(0, 10)));
        }
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["status", "remarks", "employee_id", "duty_id"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "check_in_at", ascending: filters.ascending ?? false }
    );
  },

  /**
   * Fetch every attendance row for a set of employees that *touches* the
   * supplied calendar window. Includes the no-time statuses (ABSENT / LEAVE
   * / HOLIDAY) by matching on `updated_at` when `check_in_at` is null so the
   * range board surfaces them in salary reports.
   */
  async listInRange(
    employeeIds: string[],
    fromISO: string,
    toISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const ids = (employeeIds || []).filter(Boolean);
    if (!ids.length) return { success: true, data: [] };
    const db = resolveClient(opts);
    const timed = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .in("employee_id", ids)
          .gte("check_in_at", fromISO)
          .lte("check_in_at", toISO),
      `${SCOPE}.listInRange.timed`
    );
    if (!timed.success) return timed;
    const fromKey = fromISO.slice(0, 10);
    const toKey = toISO.slice(0, 10);
    const noTime = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .in("employee_id", ids)
          .gte("work_date", fromKey)
          .lte("work_date", toKey),
      `${SCOPE}.listInRange.noTime`
    );
    if (!noTime.success) return noTime;
    const seen = new Set<string>();
    const merged: JsonRow[] = [];
    for (const row of [...(timed.data || []), ...(noTime.data || [])]) {
      const id = String(row.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    return { success: true, data: merged };
  },

  listByMonth(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("employee_id, status, hours, check_in_at, duty_id")
          .gte("check_in_at", startISO)
          .lt("check_in_at", endISO),
      `${SCOPE}.listByMonth`
    );
  },

  /** All attendance for an employee + YYYY-MM month (payout recompute aid). */
  async listForEmployeeMonth(
    employeeId: string,
    startISO: string,
    endISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("employee_id", employeeId)
          .gte("check_in_at", startISO)
          .lt("check_in_at", endISO),
      `${SCOPE}.listForEmployeeMonth`
    );
  },

  listAttendedDutyIds(employeeId: string | undefined, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(
      TABLE,
      SCOPE,
      (q) => (employeeId ? q.eq("employee_id", employeeId) : q),
      { ...opts, select: "duty_id", orderBy: "check_in_at", ascending: false }
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
