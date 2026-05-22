import { companyLogoDataUri } from "./company-logo";

export const appConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Hominal Healthcare CRM",
  companyName: process.env.NEXT_PUBLIC_COMPANY_NAME || "Hominal Healthcare Pvt Ltd",
  companyTagline: process.env.NEXT_PUBLIC_COMPANY_TAGLINE || "We Care How You Live",
  companyLogo: process.env.NEXT_PUBLIC_COMPANY_LOGO || companyLogoDataUri,
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
 *
 * Historically the legacy Express API at `api.hominalhealthcare.com` ran the
 * CRM. We retired it, but the `NEXT_PUBLIC_API_URL` env var on Vercel still
 * pointed there, causing every dashboard / reports / module request to 404.
 * Guard against that exact mis-configuration so the app survives a stale env
 * var until it can be cleared in Vercel.
 */
function resolveApiUrl() {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw) return "/api/v1";
  if (/api\.hominalhealthcare\.(com|in)/i.test(raw)) return "/api/v1";
  return raw;
}
