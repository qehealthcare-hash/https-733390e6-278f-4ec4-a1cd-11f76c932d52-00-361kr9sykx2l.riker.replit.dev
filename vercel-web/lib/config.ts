/** Static asset in `public/` — avoids a ~1.4 MB data-URI in the client bundle. */
export const DEFAULT_COMPANY_LOGO = "/company-logo.png";

export const appConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Hominal Healthcare CRM",
  companyName: process.env.NEXT_PUBLIC_COMPANY_NAME || "Hominal Healthcare Pvt Ltd",
  companyTagline: process.env.NEXT_PUBLIC_COMPANY_TAGLINE || "We Care How You Live",
  companyLogo: process.env.NEXT_PUBLIC_COMPANY_LOGO || DEFAULT_COMPANY_LOGO,
  companyPhone: process.env.NEXT_PUBLIC_COMPANY_PHONE || "7211136600",
  companyEmail: process.env.NEXT_PUBLIC_COMPANY_EMAIL || "care@hominalhealthcare.in",
  companyAddress:
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS ||
    "A,407 Shivalik Yash, Opp. Shastrinagar BRTS, Naranpura, Ahmedabad-380013",
  apiUrl: resolveApiUrl()
};

/**
 * Resolve the API base URL. The Next.js app serves every endpoint under
 * `/api/v1/*` on its own origin, so the default is the same-origin path.
 */
function resolveApiUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw) return "/api/v1";
  if (/api\.hominalhealthcare\.(com|in)/i.test(raw)) return "/api/v1";
  return raw;
}
