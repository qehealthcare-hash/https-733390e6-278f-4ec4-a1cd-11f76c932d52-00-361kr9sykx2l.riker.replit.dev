import { dbFor } from "../supabase";

/**
 * Lookup service.
 *
 * Every method now accepts an optional `accessToken` so routes can pass
 * `actor.accessToken` and RLS applies via `supabaseAsUser(...)`. When omitted
 * (legacy callers / internal jobs), falls back to the service-role admin
 * client.
 */
export const lookupService = {
  async patients(q?: string, accessToken?: string) {
    const db = dbFor(accessToken);
    let query = db
      .from("hh_patient_lookup")
      .select("*")
      .order("name")
      .limit(500);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      // Fallback in case the lookup view is not deployed yet.
      const fallback = await db
        .from("hh_patients")
        .select("id, name, phone, area, city, status")
        .order("name")
        .limit(500);
      if (fallback.error) throw fallback.error;
      return fallback.data || [];
    }
    return data || [];
  },

  async employees(q?: string, accessToken?: string) {
    const db = dbFor(accessToken);
    let query = db
      .from("hh_employee_lookup")
      .select("*")
      .order("full_name")
      .limit(500);
    if (q) query = query.ilike("full_name", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      const fallback = await db
        .from("hh_employees")
        .select("id, fn, mn, ln, phone, email, dept, desig, shift")
        .order("fn")
        .limit(500);
      if (fallback.error) throw fallback.error;
      return (fallback.data || []).map((e) => ({
        id: e.id,
        full_name: [e.fn, e.mn, e.ln].filter(Boolean).join(" ").trim(),
        phone: e.phone || "",
        email: e.email || "",
        department: e.dept || "",
        designation: e.desig || "",
        default_shift: e.shift || ""
      }));
    }
    return data || [];
  },

  async services(accessToken?: string) {
    const db = dbFor(accessToken);
    const { data, error } = await db
      .from("hh_app_settings")
      .select("value")
      .eq("key", "services")
      .maybeSingle();
    if (error) throw error;
    return data?.value || [];
  },

  async roles(accessToken?: string) {
    const db = dbFor(accessToken);
    const { data, error } = await db
      .from("hh_roles")
      .select("id, name, perms")
      .order("name");
    if (error) throw error;
    return data || [];
  }
};
