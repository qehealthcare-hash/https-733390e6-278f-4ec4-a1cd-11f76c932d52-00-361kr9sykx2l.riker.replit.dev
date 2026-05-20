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
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"
};
