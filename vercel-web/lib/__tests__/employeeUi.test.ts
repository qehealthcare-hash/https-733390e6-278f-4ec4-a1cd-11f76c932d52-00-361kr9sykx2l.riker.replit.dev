import { describe, expect, it } from "vitest";

import {
  buildEmployeePdfBody,
  escapeHtml,
  employeeDisplayName,
  rowScoreTotal
} from "@/lib/employeeUi";

describe("employeeUi", () => {
  it("escapeHtml neutralises HTML metacharacters", () => {
    expect(escapeHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  it("employeeDisplayName builds from fn/ln", () => {
    expect(employeeDisplayName({ id: "E1", fn: "Anita", ln: "Shah" })).toBe("Anita Shah");
  });

  it("rowScoreTotal averages component scores", () => {
    expect(
      rowScoreTotal({ id: "E1", score_experience: 8, score_behaviour: 6, score_testimonial: 10 })
    ).toBe(8);
  });

  it("buildEmployeePdfBody escapes injected name", () => {
    const html = buildEmployeePdfBody(
      { id: "E1", fn: "<script>", ln: "x", status: "Active" },
      false,
      [],
      null
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
