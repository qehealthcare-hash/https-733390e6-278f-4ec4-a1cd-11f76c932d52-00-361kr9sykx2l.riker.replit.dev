import { withSentryConfig } from "@sentry/nextjs";

/** Keep in sync with `lib/api/securityHeaders.ts` (also applied in middleware). */
const PERMISSIONS_POLICY =
  "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=()";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  poweredByHeader: false,
  // ESLint runs at build time (no-var sweep completed in fb03a5c9).
  eslint: { ignoreDuringBuilds: false },
  // App pages and shared hooks are typed; CI runs `tsc -p tsconfig.ci.json`.
  typescript: { ignoreBuildErrors: false },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/**" }
    ]
  },
  async headers() {
    return [
      {
        source: "/legacy/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
      },
      {
        source: "/legacy-crm.html",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains"
          },
          {
            key: "Permissions-Policy",
            value: PERMISSIONS_POLICY
          }
          // CSP (nonce + strict-dynamic) is set per-request in middleware.ts (P1-39).
        ]
      }
    ];
  }
};

const hasSentry = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

export default hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      disableLogger: true,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      tunnelRoute: "/monitoring",
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN }
    })
  : nextConfig;
