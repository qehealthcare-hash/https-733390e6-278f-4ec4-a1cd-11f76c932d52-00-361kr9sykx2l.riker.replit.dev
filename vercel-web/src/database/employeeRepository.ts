import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  countWhere,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_employees";
const SCOPE = "employeeRepository";

export interface EmployeeListFilters extends ListQuery {
  q?: string;
  status?: string;
  dept?: string;
}

export const employeeRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: EmployeeListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.dept) query = query.eq("dept", filters.dept);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["fn", "ln", "mn", "phone", "email", "area", "dept", "desig"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  /** Phone-suffix duplicate lookup. Caller filters by active status via business layer. */
  findByPhoneSuffix(suffix: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    if (!suffix) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(TABLE).select("id, fn, ln, phone, status").ilike("phone", `%${suffix}%`),
      `${SCOPE}.findByPhoneSuffix`
    );
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, SCOPE, opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, SCOPE, opts);
  },

  /** Soft-status update (also used by activate / deactivate). */
  updateStatus(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, `${SCOPE}.updateStatus`, opts);
  },

  /** Hard delete — only safe when no historical links exist (caller must check). */
  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, SCOPE, opts);
  },

  countDuties(employeeId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_duties", SCOPE, (q) => q.eq("employee_id", employeeId), opts);
  },

  countAttendance(employeeId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_attendance", SCOPE, (q) => q.eq("employee_id", employeeId), opts);
  },

  countPayouts(employeeId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_payouts", SCOPE, (q) => q.eq("employee_id", employeeId), opts);
  },

  countCaretakerAssignments(employeeId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_patients", SCOPE, (q) => q.eq("caretaker_id", employeeId), opts);
  }
};
