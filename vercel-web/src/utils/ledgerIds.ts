/** UUID v4-ish pattern (Postgres `uuid` text form). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Legacy `hh_invoice_lines.svc_entry_id` is `bigint`. Duty-calendar
 * `hh_svc_entries.id` is `uuid` — never coerce a uuid string with `Number()`.
 */
export function legacyBigintSvcEntryId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** Map a service-entry id to invoice-line FK columns. */
export function invoiceLineSvcEntryRefs(svcEntryId: unknown): {
  svc_entry_id: number | null;
  svc_entry_uuid: string | null;
} {
  const legacy = legacyBigintSvcEntryId(svcEntryId);
  if (legacy != null) {
    return { svc_entry_id: legacy, svc_entry_uuid: null };
  }
  if (isUuidString(svcEntryId)) {
    return { svc_entry_id: null, svc_entry_uuid: svcEntryId.trim() };
  }
  return { svc_entry_id: null, svc_entry_uuid: null };
}
