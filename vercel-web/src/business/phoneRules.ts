/** Normalise CRM phone numbers (digits and leading + only). */
export function normalizePhone(phone: string | undefined | null): string {
  return (phone || "").replace(/[^0-9+]/g, "");
}

/** Last 8 digits used for duplicate detection in legacy CRM. */
export function phoneSuffix(phone: string | undefined | null): string {
  return normalizePhone(phone).slice(-8);
}

export function phonesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const sa = normalizePhone(a);
  const sb = normalizePhone(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const suffix = 8;
  return sa.slice(-suffix) === sb.slice(-suffix);
}

export interface PhoneMatchRow {
  id: string;
  phone?: string | null;
  status?: string | null;
}

/** Pick first row matching phone suffix, with optional status filter. */
export function findPhoneDuplicate<T extends PhoneMatchRow>(
  candidates: T[],
  phone: string,
  opts?: {
    excludeId?: string;
    match?: (row: T) => boolean;
  }
): T | null {
  const suffix = phoneSuffix(phone);
  if (!suffix) return null;
  return (
    candidates.find((row) => {
      if (opts?.excludeId && row.id === opts.excludeId) return false;
      if (opts?.match && !opts.match(row)) return false;
      return phonesMatch(row.phone, phone);
    }) || null
  );
}
