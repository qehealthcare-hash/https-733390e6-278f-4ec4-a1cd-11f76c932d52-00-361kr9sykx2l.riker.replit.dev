import { describe, expect, it } from "vitest";
import {
  employeeStatusFromRow,
  employeeToRow,
  isActiveEmployee,
  deactivatePatch,
  activatePatch
} from "@/business/employeeRules";

describe("employeeRules — leave_date status mapping", () => {
  it("treats empty leave_date as Active when status column absent", () => {
    expect(employeeStatusFromRow({ leave_date: "" })).toBe("Active");
    expect(isActiveEmployee({ leave_date: "" })).toBe(true);
  });

  it("treats leave_date as Inactive marker", () => {
    expect(employeeStatusFromRow({ leave_date: "2026-05-01" })).toBe("Inactive");
    expect(isActiveEmployee({ leave_date: "2026-05-01" })).toBe(false);
  });

  it("employeeToRow does not write status column", () => {
    const row = employeeToRow({
      fn: "Test",
      ln: "User",
      phone: "9876543210",
      status: "Active"
    } as Parameters<typeof employeeToRow>[0]);
    expect(row).not.toHaveProperty("status");
    expect(row.leave_date).toBe("");
  });

  it("maps Inactive to leave_date on write", () => {
    const row = employeeToRow({
      fn: "Test",
      ln: "User",
      phone: "9876543210",
      status: "Inactive"
    } as Parameters<typeof employeeToRow>[0]);
    expect(String(row.leave_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("patches use leave_date only", () => {
    expect(deactivatePatch("a@test.com")).toEqual({
      leave_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      updated_by: "a@test.com"
    });
    expect(activatePatch("a@test.com")).toEqual({
      leave_date: "",
      updated_by: "a@test.com"
    });
  });
});
