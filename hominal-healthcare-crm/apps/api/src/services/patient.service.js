import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { resolvePatientSource, isMissingSchemaError } from "../lib/patient-repository.js";
import { resolveAssignedStaffIdForModernPatient } from "../lib/resolve-assigned-staff.js";

const PATIENT_DOCUMENTS_IN_CHUNK = 100;

const LEGACY_SELECT =
  "id, name, phone, dob, gender, addr, area, city, pin, relname, relphone, relname2, relphone2, relname3, relphone3, status, docs, created_at, updated_at, registered_at";
const MODERN_SELECT =
  "id, full_name, age, gender, address, area, city, pincode, mobile, disease_condition, assigned_staff_id, shift_type, start_date, status, close_reason, relative_contacts, created_at, updated_at, registered_at";

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateAge(dob) {
  const parsed = parseDate(dob);
  if (!parsed) return null;
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthGap = today.getMonth() - parsed.getMonth();
  if (monthGap < 0 || (monthGap === 0 && today.getDate() < parsed.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function mapLegacyStatus(status) {
  return String(status || "").toUpperCase() === "ACTIVE" ? "Active" : "Closed";
}

function mapModernStatus(status) {
  return String(status || "").toUpperCase() === "ACTIVE" ? "ACTIVE" : "CLOSED";
}

function mapLegacyPatientRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.name || "",
    age: calculateAge(row.dob),
    gender: row.gender || "Female",
    mobile: row.phone || "",
    address: row.addr || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    pincode: row.pin || "",
    disease_condition: "",
    assigned_staff_id: null,
    shift_type: "DAY",
    start_date: "",
    status: mapModernStatus(row.status),
    close_reason: null,
    relative_contacts: [
      row.relname || row.relphone ? { name: row.relname || "", phone: row.relphone || "" } : null,
      row.relname2 || row.relphone2 ? { name: row.relname2 || "", phone: row.relphone2 || "" } : null,
      row.relname3 || row.relphone3 ? { name: row.relname3 || "", phone: row.relphone3 || "" } : null
    ].filter(Boolean),
    patient_documents: Array.isArray(row.docs) ? row.docs : [],
    documents: Array.isArray(row.docs) ? row.docs : [],
    registered_at: row.registered_at || row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    employees: null
  };
}

function mapModernPatientRow(row, documentRows) {
  if (!row) return null;
  const contacts = Array.isArray(row.relative_contacts) ? row.relative_contacts : [];
  const normalizedContacts = contacts
    .filter(function (c) {
      return c && (c.name || c.phone);
    })
    .map(function (c) {
      return { name: String(c.name || ""), phone: String(c.phone || "") };
    });
  const docs = Array.isArray(documentRows)
    ? documentRows.map(function mapDoc(d) {
        return {
          bucket: d.bucket,
          path: d.path,
          file_name: d.file_name,
          mime_type: d.mime_type,
          created_at: d.created_at
        };
      })
    : [];
  return {
    id: row.id,
    full_name: row.full_name || "",
    age: Number(row.age ?? 0),
    gender: row.gender || "Female",
    mobile: row.mobile || "",
    address: row.address || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    pincode: row.pincode || "",
    disease_condition: row.disease_condition || "",
    assigned_staff_id: row.assigned_staff_id || null,
    shift_type: row.shift_type || "DAY",
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : "",
    status: mapModernStatus(row.status),
    close_reason: row.close_reason || null,
    relative_contacts:
      normalizedContacts.length > 0
        ? normalizedContacts
        : [
            { name: "", phone: "" },
            { name: "", phone: "" },
            { name: "", phone: "" }
          ],
    patient_documents: docs,
    documents: docs,
    registered_at: row.registered_at || row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    employees: null
  };
}

function toLegacyPayload(payload) {
  const contacts = payload.relative_contacts || [];
  return {
    name: payload.full_name,
    phone: payload.mobile,
    email: "",
    dob: "",
    gender: payload.gender,
    blood: "",
    addr: payload.address || "",
    area: payload.area,
    city: payload.city,
    pin: payload.pincode,
    relname: contacts[0]?.name || "",
    relphone: contacts[0]?.phone || "",
    relname2: contacts[1]?.name || "",
    relphone2: contacts[1]?.phone || "",
    relname3: contacts[2]?.name || "",
    relphone3: contacts[2]?.phone || "",
    status: mapLegacyStatus(payload.status),
    docs: payload.documents || []
  };
}

function toModernPayload(payload) {
  const contacts = (payload.relative_contacts || []).map(function (c) {
    return { name: String(c.name || "").trim(), phone: String(c.phone || "").trim() };
  });
  return {
    full_name: payload.full_name,
    age: Number(payload.age || 0),
    gender: payload.gender,
    address: payload.address || "",
    area: payload.area,
    city: payload.city,
    pincode: payload.pincode,
    mobile: payload.mobile,
    disease_condition: payload.disease_condition,
    assigned_staff_id: payload.assigned_staff_id || null,
    shift_type: payload.shift_type,
    start_date: payload.start_date,
    status: payload.status,
    close_reason: payload.close_reason || null,
    relative_contacts: contacts
  };
}

function generatePatientId() {
  return "PID" + Date.now().toString().slice(-9);
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function fetchModernPatientDocumentsByPatientIds(patientIds) {
  const ids = (patientIds || []).filter(Boolean);
  if (!ids.length) {
    return {};
  }
  const map = {};
  for (let offset = 0; offset < ids.length; offset += PATIENT_DOCUMENTS_IN_CHUNK) {
    const slice = ids.slice(offset, offset + PATIENT_DOCUMENTS_IN_CHUNK);
    const result = await supabaseAdmin
      .from("patient_documents")
      .select("patient_id, bucket, path, file_name, mime_type, created_at")
      .in("patient_id", slice)
      .order("created_at", { ascending: true });
    if (result.error) {
      if (isMissingSchemaError(result.error)) {
        return {};
      }
      throw new HttpError(500, result.error.message);
    }
    (result.data || []).forEach(function eachDoc(row) {
      if (!map[row.patient_id]) {
        map[row.patient_id] = [];
      }
      map[row.patient_id].push(row);
    });
  }
  return map;
}

export const patientService = {
  async list() {
    const source = await resolvePatientSource(supabaseAdmin);
    if (source.kind === "modern") {
      const result = await supabaseAdmin.from(source.table).select(MODERN_SELECT).order("created_at", { ascending: true });
      if (result.error) throw new HttpError(500, result.error.message);
      const rows = result.data || [];
      const docMap = await fetchModernPatientDocumentsByPatientIds(rows.map(function (r) {
        return r.id;
      }));
      return rows.map(function (row) {
        return mapModernPatientRow(row, docMap[row.id] || []);
      });
    }
    const result = await supabaseAdmin.from(source.table).select(LEGACY_SELECT).order("created_at", { ascending: true });
    if (result.error) throw new HttpError(500, result.error.message);
    return (result.data || []).map(mapLegacyPatientRow);
  },

  async getById(id) {
    const source = await resolvePatientSource(supabaseAdmin);
    if (source.kind === "modern") {
      const result = await supabaseAdmin.from(source.table).select(MODERN_SELECT).eq("id", id).single();
      if (result.error) throw new HttpError(result.status || 500, result.error.message);
      const docMap = await fetchModernPatientDocumentsByPatientIds([id]);
      return mapModernPatientRow(result.data, docMap[id] || []);
    }
    const result = await supabaseAdmin.from(source.table).select(LEGACY_SELECT).eq("id", id).single();
    if (result.error) throw new HttpError(result.status || 500, result.error.message);
    return mapLegacyPatientRow(result.data);
  },

  async create(payload) {
    const source = await resolvePatientSource(supabaseAdmin);
    if (source.kind === "modern") {
      const resolvedStaff = await resolveAssignedStaffIdForModernPatient(supabaseAdmin, payload.assigned_staff_id);
      const insertRow = toModernPayload({
        ...payload,
        assigned_staff_id: resolvedStaff
      });
      if (payload.id && isUuid(payload.id)) {
        insertRow.id = payload.id;
      }
      const result = await supabaseAdmin.from(source.table).insert(insertRow).select(MODERN_SELECT).single();
      if (result.error) throw new HttpError(500, result.error.message);
      return mapModernPatientRow(result.data, []);
    }
    const result = await supabaseAdmin
      .from(source.table)
      .insert({
        id: payload.id || generatePatientId(),
        created: new Date().toISOString(),
        ...toLegacyPayload(payload)
      })
      .select(LEGACY_SELECT)
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    return mapLegacyPatientRow(result.data);
  },

  async update(id, payload) {
    const source = await resolvePatientSource(supabaseAdmin);
    if (source.kind === "modern") {
      const resolvedStaff = await resolveAssignedStaffIdForModernPatient(supabaseAdmin, payload.assigned_staff_id);
      const result = await supabaseAdmin
        .from(source.table)
        .update(
          toModernPayload({
            ...payload,
            assigned_staff_id: resolvedStaff
          })
        )
        .eq("id", id)
        .select(MODERN_SELECT)
        .single();
      if (result.error) throw new HttpError(500, result.error.message);
      const docMap = await fetchModernPatientDocumentsByPatientIds([id]);
      return mapModernPatientRow(result.data, docMap[id] || []);
    }
    const result = await supabaseAdmin.from(source.table).update(toLegacyPayload(payload)).eq("id", id).select(LEGACY_SELECT).single();
    if (result.error) throw new HttpError(500, result.error.message);
    return mapLegacyPatientRow(result.data);
  },

  async remove(id) {
    const source = await resolvePatientSource(supabaseAdmin);
    const result = await supabaseAdmin.from(source.table).delete().eq("id", id);
    if (result.error) throw new HttpError(500, result.error.message);
    return true;
  },

  async replaceDocuments(patientId, documents) {
    const source = await resolvePatientSource(supabaseAdmin);
    if (source.kind === "modern") {
      const del = await supabaseAdmin.from("patient_documents").delete().eq("patient_id", patientId);
      if (del.error) {
        if (isMissingSchemaError(del.error)) {
          console.warn("[patients] replaceDocuments: patient_documents table unavailable", del.error.message);
          return documents || [];
        }
        throw new HttpError(500, del.error.message);
      }
      const list = Array.isArray(documents) ? documents : [];
      if (list.length) {
        const insertRows = list.map(function mapInsert(doc) {
          return {
            patient_id: patientId,
            bucket: doc.bucket,
            path: doc.path,
            file_name: doc.file_name,
            mime_type: doc.mime_type
          };
        });
        const ins = await supabaseAdmin.from("patient_documents").insert(insertRows);
        if (ins.error) {
          if (isMissingSchemaError(ins.error)) {
            return documents || [];
          }
          throw new HttpError(500, ins.error.message);
        }
      }
      const docMap = await fetchModernPatientDocumentsByPatientIds([patientId]);
      return docMap[patientId] || [];
    }
    const result = await supabaseAdmin
      .from(source.table)
      .update({
        docs: documents || []
      })
      .eq("id", patientId)
      .select("docs")
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data?.docs || [];
  }
};
