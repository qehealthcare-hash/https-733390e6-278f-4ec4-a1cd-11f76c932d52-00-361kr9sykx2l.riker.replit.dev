import type { NextResponse } from "next/server";

/**
 * Permissions-Policy for the CRM app shell (P1-E).
 * `camera=(self)` — patient/employee photo capture via getUserMedia.
 * Everything else stays off unless a module needs it later.
 */
export const PERMISSIONS_POLICY =
  "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=()";

export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

/** Apply baseline headers on every middleware-handled response. */
export function applyBaselineSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  return response;
}
