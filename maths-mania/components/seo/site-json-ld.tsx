import { organizationSchema, websiteSchema } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";

/** Site-wide Organization + WebSite structured data on marketing pages. */
export function SiteJsonLd() {
  return <JsonLd data={[organizationSchema(), websiteSchema()]} />;
}
