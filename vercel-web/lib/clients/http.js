/**
 * Shared HTTP helpers for typed CRM API clients.
 *
 * Pages should import domain clients (`patientsClient`, …) instead of
 * building `/api/v1/...` path strings inline.
 */

/**
 * @param {Record<string, string | number | boolean | undefined | null>} params
 * @returns {string}
 */
export function toQueryString(params) {
  var parts = [];
  if (!params) return "";
  Object.keys(params).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === "") return;
    parts.push(key + "=" + encodeURIComponent(String(value)));
  });
  return parts.join("&");
}

/**
 * @param {string} base
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
export function withQuery(base, params) {
  var qs = toQueryString(params);
  return qs ? base + "?" + qs : base;
}
