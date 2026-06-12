import { NextResponse, type NextRequest } from "next/server";
import { applyBaselineSecurityHeaders } from "@/lib/api/securityHeaders";

/**
 * Per-request CSP with nonce (P1-39). Static headers in next.config omit script-src
 * unsafe-inline; this middleware sets script-src 'nonce-…' 'strict-dynamic'.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://*.ingest.sentry.io https://*.sentry.io`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    // P1-E: getUserMedia preview attaches a MediaStream via video.srcObject (mediastream:).
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://*.ingest.sentry.io https://*.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  return applyBaselineSecurityHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
