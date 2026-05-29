/**
 * Sanitises a user-supplied search term before it is interpolated into a
 * PostgREST `.or(...)` filter string.
 *
 * Lives in `src/utils` (not `lib/api`) so repositories can import it without
 * creating a Database → API-layer reverse dependency.
 */
export function sanitizeSearchTerm(raw: string | null | undefined, maxLength = 64): string {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/[,()*%\\]/g, "");
  return stripped.slice(0, maxLength);
}
