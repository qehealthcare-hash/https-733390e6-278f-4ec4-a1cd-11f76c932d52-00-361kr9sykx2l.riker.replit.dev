import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function mapDbError(result, fallback) {
  if (result.error) {
    const msg = result.error.message || fallback;
    if (msg.indexOf("does not exist") !== -1 || result.error.code === "42P01") {
      throw new HttpError(503, "Database schema not migrated: run Supabase migrations through 006+");
    }
    throw new HttpError(400, msg);
  }
}

export const referenceService = {
  async listDoctors() {
    const q = await supabaseAdmin
      .from("doctors")
      .select("*")
      .is("deleted_at", null)
      .order("full_name", { ascending: true });
    mapDbError(q, "Failed to list doctors");
    return q.data || [];
  },

  async getDoctor(id) {
    const q = await supabaseAdmin.from("doctors").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
    mapDbError(q, "Failed to load doctor");
    if (!q.data) throw new HttpError(404, "Doctor not found");
    return q.data;
  },

  async createDoctor(payload, actorUserId) {
    const row = {
      full_name: payload.full_name,
      specialization: payload.specialization || "",
      mobile: payload.mobile || "",
      email: payload.email || "",
      address: payload.address || "",
      active: payload.active !== false,
      created_by: actorUserId || null,
      updated_by: actorUserId || null
    };
    const q = await supabaseAdmin.from("doctors").insert(row).select("*").single();
    mapDbError(q, "Failed to create doctor");
    return q.data;
  },

  async updateDoctor(id, payload, actorUserId) {
    const row = Object.assign({}, payload, { updated_by: actorUserId || null });
    delete row.id;
    const q = await supabaseAdmin.from("doctors").update(row).eq("id", id).is("deleted_at", null).select("*").single();
    mapDbError(q, "Failed to update doctor");
    if (!q.data) throw new HttpError(404, "Doctor not found");
    return q.data;
  },

  async softDeleteDoctor(id, actorUserId) {
    const q = await supabaseAdmin
      .from("doctors")
      .update({ deleted_at: new Date().toISOString(), deleted_by: actorUserId || null })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    mapDbError(q, "Failed to delete doctor");
    if (!q.data) throw new HttpError(404, "Doctor not found");
    return q.data;
  },

  async listVendors() {
    const q = await supabaseAdmin
      .from("vendors")
      .select("*")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    mapDbError(q, "Failed to list vendors");
    return q.data || [];
  },

  async getVendor(id) {
    const q = await supabaseAdmin.from("vendors").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
    mapDbError(q, "Failed to load vendor");
    if (!q.data) throw new HttpError(404, "Vendor not found");
    return q.data;
  },

  async createVendor(payload, actorUserId) {
    const row = {
      name: payload.name,
      contact_name: payload.contact_name || "",
      mobile: payload.mobile || "",
      email: payload.email || "",
      gst: payload.gst || "",
      pan: payload.pan || "",
      address: payload.address || "",
      city: payload.city || "",
      active: payload.active !== false,
      created_by: actorUserId || null,
      updated_by: actorUserId || null
    };
    const q = await supabaseAdmin.from("vendors").insert(row).select("*").single();
    mapDbError(q, "Failed to create vendor");
    return q.data;
  },

  async updateVendor(id, payload, actorUserId) {
    const row = Object.assign({}, payload, { updated_by: actorUserId || null });
    delete row.id;
    const q = await supabaseAdmin.from("vendors").update(row).eq("id", id).is("deleted_at", null).select("*").single();
    mapDbError(q, "Failed to update vendor");
    if (!q.data) throw new HttpError(404, "Vendor not found");
    return q.data;
  },

  async softDeleteVendor(id, actorUserId) {
    const q = await supabaseAdmin
      .from("vendors")
      .update({ deleted_at: new Date().toISOString(), deleted_by: actorUserId || null })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    mapDbError(q, "Failed to delete vendor");
    if (!q.data) throw new HttpError(404, "Vendor not found");
    return q.data;
  },

  async listServiceCatalog() {
    const q = await supabaseAdmin
      .from("service_catalog")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    mapDbError(q, "Failed to list service catalog");
    return q.data || [];
  },

  async listAppSettings() {
    const q = await supabaseAdmin.from("app_settings").select("*").order("key", { ascending: true });
    mapDbError(q, "Failed to list settings");
    return q.data || [];
  },

  async getAppSetting(key) {
    const q = await supabaseAdmin.from("app_settings").select("*").eq("key", key).maybeSingle();
    mapDbError(q, "Failed to load setting");
    return q.data;
  },

  async upsertAppSetting(key, value, actorUserId) {
    const q = await supabaseAdmin
      .from("app_settings")
      .upsert(
        {
          key,
          value,
          updated_by: actorUserId || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: "key" }
      )
      .select("*")
      .single();
    mapDbError(q, "Failed to save setting");
    return q.data;
  }
};
