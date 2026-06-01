import { describe, expect, it } from "vitest";
import { buildEmployeePermissions } from "@/business/employeeRules";

describe("buildEmployeePermissions", () => {
  it("allows edit / deactivate on an Active employee", () => {
    const perms = buildEmployeePermissions({ status: "Active" });
    expect(perms.canEdit).toBe(true);
    expect(perms.canDeactivate).toBe(true);
    expect(perms.canActivate).toBe(false);
    expect(perms.canChangeStatus).toBe(true);
    expect(perms.canHardDelete).toBe(false);
    expect(perms.blockReasons?.canHardDelete).toMatch(/active employees/i);
  });

  it("flips deactivate / activate for an Inactive employee", () => {
    const perms = buildEmployeePermissions({ status: "Inactive" });
    expect(perms.canEdit).toBe(false);
    expect(perms.canDeactivate).toBe(false);
    expect(perms.canActivate).toBe(true);
    expect(perms.canHardDelete).toBe(true);
    expect(perms.blockReasons?.canEdit).toMatch(/read-only/i);
  });

  it("respects link counts for hard delete when supplied", () => {
    const perms = buildEmployeePermissions({
      status: "Inactive",
      linkCounts: { duties: 0, attendance: 0, payouts: 1, caretakerOf: 0 }
    });
    expect(perms.canHardDelete).toBe(false);
    expect(perms.blockReasons?.canHardDelete).toMatch(/historical/i);
  });

  it("blocks edit for OnLeave / Suspended but allows status change", () => {
    for (const status of ["OnLeave", "Suspended"] as const) {
      const perms = buildEmployeePermissions({ status });
      expect(perms.canEdit, `${status} canEdit`).toBe(false);
      expect(perms.canActivate, `${status} canActivate`).toBe(true);
      expect(perms.canChangeStatus, `${status} canChangeStatus`).toBe(true);
    }
  });
});
