import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

const INQUIRY_TABLE = "hh_inquiries";

function mapInquiryRow(row) {
  return {
    id: row.id,
    patient_name: row.name || "",
    mobile: row.phone || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    service_required: row.service || "",
    source: String(row.source || "WHATSAPP").toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_+|_+$/g, "") || "WHATSAPP",
    potential: String(row.potential || "WARM").toUpperCase(),
    emergency_level: Number(row.rating_emergency || 5),
    flexibility_score: Number(row.rating_flexibility || 5),
    priority_score: Number(row.rating_overall || 5),
    notes: row.notes || "",
    created_at: row.created_at || row.created
  };
}

function toLegacyPayload(payload) {
  return {
    id: payload.id,
    name: payload.patient_name,
    phone: payload.mobile,
    wa: payload.mobile,
    age: "",
    gender: "",
    city: payload.city || "Ahmedabad",
    area: payload.area || "",
    service: payload.service_required || "",
    source: payload.source || "WHATSAPP",
    potential: payload.potential || "WARM",
    rating_emergency: Number(payload.emergency_level || 5),
    rating_flexibility: Number(payload.flexibility_score || 5),
    rating_overall: Number(payload.priority_score || 5),
    status: "New",
    assigned_to: "",
    followup_date: "",
    notes: payload.notes || "",
    created: new Date().toISOString()
  };
}

function generateInquiryId() {
  return "INQ" + Date.now().toString().slice(-7);
}

export const inquiryService = {
  async list() {
    const result = await supabaseAdmin.from(INQUIRY_TABLE).select("*").order("created_at", { ascending: false });
    if (result.error) throw new HttpError(500, result.error.message);
    return (result.data || []).map(mapInquiryRow);
  },
  async getById(id) {
    const result = await supabaseAdmin.from(INQUIRY_TABLE).select("*").eq("id", id).single();
    if (result.error) throw new HttpError(result.status || 500, result.error.message);
    return mapInquiryRow(result.data);
  },
  async create(payload) {
    const result = await supabaseAdmin.from(INQUIRY_TABLE).insert({
      ...toLegacyPayload(payload),
      id: payload.id || generateInquiryId()
    }).select("*").single();
    if (result.error) throw new HttpError(500, result.error.message);
    return mapInquiryRow(result.data);
  },
  async update(id, payload) {
    const result = await supabaseAdmin.from(INQUIRY_TABLE).update(toLegacyPayload(payload)).eq("id", id).select("*").single();
    if (result.error) throw new HttpError(500, result.error.message);
    return mapInquiryRow(result.data);
  },
  async remove(id) {
    const result = await supabaseAdmin.from(INQUIRY_TABLE).delete().eq("id", id);
    if (result.error) throw new HttpError(500, result.error.message);
    return true;
  }
};
