import { HttpError } from "./http-error.js";

export function isMissingSchemaError(error) {
  if (!error) return false;
  return (
    ["42P01", "42703", "42883", "PGRST204"].includes(error.code) ||
    /does not exist|Could not find the .* column/i.test(error.message || "")
  );
}

let cachedSource = null;

/**
 * Resolves which physical patients table this deployment uses.
 * - CRM_PATIENT_TABLE=hh_patients | patients forces that table.
 * - Otherwise: use hh_patients when the table exists, else patients (clean installs).
 */
export async function resolvePatientSource(supabaseAdmin) {
  if (cachedSource) {
    return cachedSource;
  }
  const explicit = String(process.env.CRM_PATIENT_TABLE || "")
    .trim()
    .toLowerCase();
  if (explicit === "patients") {
    cachedSource = { kind: "modern", table: "patients" };
    return cachedSource;
  }
  if (explicit === "hh_patients") {
    cachedSource = { kind: "legacy", table: "hh_patients" };
    return cachedSource;
  }

  const legacyProbe = await supabaseAdmin.from("hh_patients").select("id").limit(1);
  if (!legacyProbe.error) {
    cachedSource = { kind: "legacy", table: "hh_patients" };
    return cachedSource;
  }
  if (!isMissingSchemaError(legacyProbe.error)) {
    throw new HttpError(500, legacyProbe.error.message);
  }

  const modernProbe = await supabaseAdmin.from("patients").select("id").limit(1);
  if (!modernProbe.error) {
    cachedSource = { kind: "modern", table: "patients" };
    return cachedSource;
  }
  if (!isMissingSchemaError(modernProbe.error)) {
    throw new HttpError(500, modernProbe.error.message);
  }

  cachedSource = { kind: "legacy", table: "hh_patients" };
  return cachedSource;
}

/** For tests or long-running workers after migrations. */
export function resetPatientSourceCache() {
  cachedSource = null;
}
