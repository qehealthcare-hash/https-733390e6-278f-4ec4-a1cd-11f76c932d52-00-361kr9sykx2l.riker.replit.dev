/**
 * Shared HTTP helpers for typed CRM API clients.
 */

export function toQueryString(
  params: Record<string, string | number | boolean | undefined | null> | null | undefined
): string {
  const parts: string[] = [];
  if (!params) return "";
  Object.keys(params).forEach(function (key) {
    const value = params[key];
    if (value === undefined || value === null || value === "") return;
    parts.push(key + "=" + encodeURIComponent(String(value)));
  });
  return parts.join("&");
}

export function withQuery(
  base: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const qs = toQueryString(params);
  return qs ? base + "?" + qs : base;
}
