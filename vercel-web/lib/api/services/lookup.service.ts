import { supabaseAdmin } from "../supabase";

export const lookupService = {
  async patients(q?: string) {
    let query = supabaseAdmin()
      .from("hh_patient_lookup")
      .select("*")
      .order("name")
      .limit(500);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      // Fallback in case the lookup view is not deployed yet.
      const fallback = await supabaseAdmin().from("hh_patients").select("id, name, phone, area, city, status").order("name").limit(500);
      if (fallback.error) throw fallback.error;
      return fallback.data || [];
    }
    return data || [];
  },

  async employees(q?: string) {
    let query = supabaseAdmin()
      .from("hh_employee_lookup")
      .select("*")
      .order("full_name")
      .limit(500);
    if (q) query = query.ilike("full_name", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      const fallback = await supabaseAdmin()
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

  async services() {
    const { data, error } = await supabaseAdmin()
      .from("hh_app_settings")
      .select("payload")
      .eq("section", "services")
      .maybeSingle();
    if (error) throw error;
    return data?.payload || [];
  },

  async roles() {
    const { data, error } = await supabaseAdmin()
      .from("hh_roles")
      .select("id, name, perms")
      .order("name");
    if (error) throw error;
    return data || [];
  }
};
