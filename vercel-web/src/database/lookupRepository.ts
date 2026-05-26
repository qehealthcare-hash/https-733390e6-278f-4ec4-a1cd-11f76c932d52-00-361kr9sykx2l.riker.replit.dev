/**
 * Lookup repository — read-only views feeding dropdowns / typeaheads.
 *
 * Each list method falls back to the underlying table if the optimised
 * view (`hh_*_lookup`) hasn't been deployed yet, so the UI degrades
 * gracefully during migrations.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import { resolveClient } from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";

export const lookupRepository = {
  /** Patient lookup view (id, name, phone, area, city, status). */
  async patients(q: string | undefined, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const primary = await runListQuery<JsonRow>(async () => {
      let query = db.from("hh_patient_lookup").select("*").order("name").limit(500);
      if (q) query = query.ilike("name", `%${q}%`);
      const { data, error } = await query;
      return { data, error };
    }, "lookup.patients");
    if (primary.success) return primary;

    return runListQuery<JsonRow>(async () => {
      let query = db
        .from("hh_patients")
        .select("id, name, phone, area, city, status")
        .order("name")
        .limit(500);
      if (q) query = query.ilike("name", `%${q}%`);
      const { data, error } = await query;
      return { data, error };
    }, "lookup.patients.fallback");
  },

  /** Employee lookup view (id, full_name, phone, email, department, designation, default_shift). */
  async employees(q: string | undefined, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const primary = await runListQuery<JsonRow>(async () => {
      let query = db.from("hh_employee_lookup").select("*").order("full_name").limit(500);
      if (q) query = query.ilike("full_name", `%${q}%`);
      const { data, error } = await query;
      return { data, error };
    }, "lookup.employees");
    if (primary.success) return primary;

    const fallback = await runListQuery<JsonRow>(async () => {
      const { data, error } = await db
        .from("hh_employees")
        .select("id, fn, mn, ln, phone, email, dept, desig, shift")
        .order("fn")
        .limit(500);
      return { data, error };
    }, "lookup.employees.fallback");
    if (!fallback.success) return fallback;
    const rows = fallback.data ?? [];
    return {
      success: true,
      data: rows.map((e) => ({
        id: e.id,
        full_name: [e.fn, e.mn, e.ln].filter(Boolean).join(" ").trim(),
        phone: e.phone || "",
        email: e.email || "",
        department: e.dept || "",
        designation: e.desig || "",
        default_shift: e.shift || ""
      }))
    };
  },

  /** Service catalog (stored in hh_app_settings as a single JSON array). */
  async services(opts?: DbAccess): Promise<ApiResult<unknown[]>> {
    const db = resolveClient(opts);
    const row = await runQuery<{ value: unknown }>(
      () =>
        db
          .from("hh_app_settings")
          .select("value")
          .eq("key", "services")
          .maybeSingle(),
      "lookup.services"
    );
    if (!row.success) {
      return { success: false, error: row.error, code: row.code, details: row.details };
    }
    const value = row.data?.value;
    return { success: true, data: Array.isArray(value) ? value : [] };
  },

  /** Role catalog (id, name, perms). */
  async roles(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(async () => {
      const { data, error } = await db
        .from("hh_roles")
        .select("id, name, perms")
        .order("name");
      return { data, error };
    }, "lookup.roles");
  }
};
