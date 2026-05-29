import { describe, expect, it } from "vitest";
import { buildInquiryPdfBody, escapeHtml } from "@/lib/inquiryUi";

describe("inquiryUi", () => {
  it("escapeHtml neutralises script tags", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("buildInquiryPdfBody escapes user-controlled fields", () => {
    const html = buildInquiryPdfBody(
      {
        id: "INQ1",
        patient_name: "<b>Bold</b>",
        mobile: "9876543210",
        area: "Satellite",
        city: "Ahmedabad",
        service_required: "24hr",
        source: "WHATSAPP",
        potential: "HOT",
        status: "New",
        notes: 'He said "call"'
      },
      false
    );
    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    expect(html).toContain("He said &quot;call&quot;");
  });
});
