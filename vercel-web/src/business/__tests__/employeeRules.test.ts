import { describe, expect, it } from "vitest";
import {
  employeeStatusFromRow,
  employeeToRow,
  employeeNameKey,
  findActiveEmployeeByName,
  findActiveEmployeeByAadhar,
  normalizeAadhar,
  isActiveEmployee,
  deactivatePatch,
  activatePatch,
  statusPatch
} from "@/business/employeeRules";

describe("employeeRules — status persistence (column + leave_date)", () => {
  it("treats empty leave_date as Active when status column absent", () => {
    expect(employeeStatusFromRow({ leave_date: "" })).toBe("Active");
    expect(isActiveEmployee({ leave_date: "" })).toBe(true);
  });

  it("treats leave_date as Inactive marker when status missing", () => {
    expect(employeeStatusFromRow({ leave_date: "2026-05-01" })).toBe("Inactive");
    expect(isActiveEmployee({ leave_date: "2026-05-01" })).toBe(false);
  });

  it("employeeToRow writes the explicit status column (Active)", () => {
    const row = employeeToRow({
      fn: "Test",
      ln: "User",
      phone: "9876543210",
      status: "Active"
    } as Parameters<typeof employeeToRow>[0]);
    expect(row.status).toBe("Active");
    expect(row.leave_date).toBe("");
  });

  it("employeeToRow writes status='Inactive' AND a leave_date stamp", () => {
    const row = employeeToRow({
      fn: "Test",
      ln: "User",
      phone: "9876543210",
      status: "Inactive"
    } as Parameters<typeof employeeToRow>[0]);
    expect(row.status).toBe("Inactive");
    expect(String(row.leave_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deactivatePatch stamps both status AND leave_date", () => {
    expect(deactivatePatch("a@test.com")).toEqual({
      status: "Inactive",
      leave_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      updated_by: "a@test.com"
    });
  });

  it("activatePatch clears leave_date AND sets status='Active'", () => {
    expect(activatePatch("a@test.com")).toEqual({
      status: "Active",
      leave_date: "",
      updated_by: "a@test.com"
    });
  });

  it("employeeNameKey normalises case and whitespace", () => {
    expect(employeeNameKey({ fn: "  Kundanben  ", ln: "Shah" })).toBe("kundanben shah");
  });

  it("findActiveEmployeeByName matches active rows only", () => {
    const hit = findActiveEmployeeByName(
      [
        { id: "1", fn: "Kundanben", ln: "Shah", status: "Active" },
        { id: "2", fn: "Kundanben", ln: "Shah", status: "Inactive" }
      ],
      { fn: "kundanben", ln: "shah" }
    );
    expect(hit?.id).toBe("1");
  });

  it("findActiveEmployeeByAadhar matches 12-digit identity", () => {
    const hit = findActiveEmployeeByAadhar(
      [{ id: "1", aadhar: "930753172933", status: "Active" }],
      "9307 5317 2933"
    );
    expect(hit?.id).toBe("1");
    expect(normalizeAadhar("9307-5317-2933")).toBe("930753172933");
  });

  it("statusPatch persists OnLeave/Suspended as explicit status (not just leave_date)", () => {
    const onLeave = statusPatch("OnLeave", "a@test.com", "vacation");
    expect(onLeave.status).toBe("OnLeave");
    expect(String(onLeave.leave_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const suspended = statusPatch("Suspended", "a@test.com", "investigation");
    expect(suspended.status).toBe("Suspended");
    expect(String(suspended.leave_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
