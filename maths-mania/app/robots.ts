import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { pageUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/dashboard/",
          "/admin",
          "/admin/",
          "/login",
          "/signup",
          "/verify",
          "/onboarding",
          "/auth/",
          "/api/",
          "/exams/*/attempt",
          "/exams/*/lobby",
          "/exams/*/result",
        ],
      },
    ],
    sitemap: pageUrl("/sitemap.xml"),
    host: SITE.url.replace(/\/$/, ""),
  };
}
