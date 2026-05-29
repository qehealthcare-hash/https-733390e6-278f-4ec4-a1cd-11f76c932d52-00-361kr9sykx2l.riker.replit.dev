import { describe, expect, it } from "vitest";

import {
  buildPatientPdfBody,
  escapeHtml,
  patientDisplayName,
  patientListPosition
} from "@/lib/patientUi";

describe("patientUi", () => {
  it("escapeHtml neutralises HTML metacharacters", () => {
    expect(escapeHtml('<script>"x"</script>')).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;"
    );
  });

  it("patientDisplayName prefers full_name", () => {
    expect(patientDisplayName({ id: "P1", full_name: "Anita", name: "Other" })).toBe("Anita");
  });

  it("patientListPosition is 1-based across pages", () => {
    expect(patientListPosition(2, 50, 0)).toBe(51);
  });

  it("buildPatientPdfBody escapes injected name", () => {
    const html = buildPatientPdfBody(
      { id: "P1", full_name: "<b>Evil</b>", status: "Active" },
      false,
      [],
      null,
      "Caretaker"
    );
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(html).not.toContain("<b>Evil</b>");
  });
});
