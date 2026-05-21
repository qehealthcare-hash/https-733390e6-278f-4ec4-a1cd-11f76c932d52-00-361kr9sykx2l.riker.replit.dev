import { HttpError } from "./http-error.js";
import { isMissingSchemaError } from "./patient-repository.js";

function isUuid(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Maps UI / legacy staff identifiers to public.employees.id for modern patients.assigned_staff_id FK.
 * - UUID: returned only if a row exists in public.employees.
 * - Non-UUID (e.g. hh_employees id): looks up hh_employees by id, then matches employees.mobile to that phone.
 * CRM_ASSIGNED_STAFF_RESOLUTION=off — pass through UUID only; non-UUID becomes null.
 * CRM_REJECT_UNRESOLVED_STAFF=true — throws 400 when a non-empty id cannot be resolved.
 */
export async function resolveAssignedStaffIdForModernPatient(supabaseAdmin, rawId) {
  if (rawId === null || rawId === undefined) {
    return null;
  }
  const trimmed = String(rawId).trim();
  if (!trimmed) {
    return null;
  }

  if (String(process.env.CRM_ASSIGNED_STAFF_RESOLUTION || "").toLowerCase() === "off") {
    return isUuid(trimmed) ? trimmed : null;
  }

  if (isUuid(trimmed)) {
    const direct = await supabaseAdmin.from("employees").select("id").eq("id", trimmed).maybeSingle();
    if (direct.error) {
      if (isMissingSchemaError(direct.error)) {
        return null;
      }
      throw new HttpError(500, direct.error.message);
    }
    if (direct.data?.id) {
      return direct.data.id;
    }
    return rejectOrNull(trimmed, null, "No employees row for this UUID");
  }

  const legacy = await supabaseAdmin.from("hh_employees").select("id, phone").eq("id", trimmed).maybeSingle();
  if (legacy.error) {
    if (isMissingSchemaError(legacy.error)) {
      return rejectOrNull(trimmed, null, "Legacy employees table not available");
    }
    throw new HttpError(500, legacy.error.message);
  }
  if (!legacy.data) {
    return rejectOrNull(trimmed, null, "Legacy employee id not found: " + trimmed);
  }

  const phone = String(legacy.data.phone || "").trim();
  if (!phone) {
    return rejectOrNull(trimmed, null, "Legacy employee has no phone to match: " + trimmed);
  }

  const byMobile = await supabaseAdmin.from("employees").select("id").eq("mobile", phone).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (byMobile.error) {
    if (isMissingSchemaError(byMobile.error)) {
      return rejectOrNull(trimmed, null, "employees table not available");
    }
    throw new HttpError(500, byMobile.error.message);
  }
  if (byMobile.data?.id) {
    return byMobile.data.id;
  }

  return rejectOrNull(trimmed, null, "No modern employees row with mobile matching legacy id " + trimmed);
}

function rejectOrNull(original, resolved, reason) {
  if (String(process.env.CRM_REJECT_UNRESOLVED_STAFF || "").toLowerCase() === "true") {
    throw new HttpError(400, "Could not resolve assigned staff: " + reason);
  }
  if (original) {
    console.warn("[staff-resolve]", reason);
  }
  return resolved;
}
