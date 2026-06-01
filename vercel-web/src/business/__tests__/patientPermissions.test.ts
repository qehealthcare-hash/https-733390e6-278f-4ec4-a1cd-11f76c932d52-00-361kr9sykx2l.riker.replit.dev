import { describe, expect, it } from "vitest";
import { buildPatientPermissions } from "@/business/patientRules";

describe("buildPatientPermissions", () => {
  it("opens edit / assign / close on an Active patient", () => {
    const perms = buildPatientPermissions({ status: "Active" });
    expect(perms.canEdit).toBe(true);
    expect(perms.canAssignCaretaker).toBe(true);
    expect(perms.canClose).toBe(true);
    expect(perms.canReopen).toBe(false);
    expect(perms.canHardDelete).toBe(false);
    expect(perms.blockReasons?.canHardDelete).toMatch(/active patients/i);
  });

  it("locks profile edits when the patient is Closed but allows reopen", () => {
    const perms = buildPatientPermissions({ status: "Closed" });
    expect(perms.canEdit).toBe(false);
    expect(perms.canAssignCaretaker).toBe(false);
    expect(perms.canClose).toBe(false);
    expect(perms.canReopen).toBe(true);
    expect(perms.canHardDelete).toBe(true);
  });

  it("blocks every state-locked action for Deceased / Expired", () => {
    for (const status of ["Deceased", "Expired", "Discharged", "Inactive"]) {
      const perms = buildPatientPermissions({ status });
      expect(perms.canEdit, `${status} canEdit`).toBe(false);
      expect(perms.canAssignCaretaker, `${status} canAssignCaretaker`).toBe(false);
      expect(perms.canReopen, `${status} canReopen`).toBe(true);
    }
  });

  it("respects linked-row counts for hard delete when supplied", () => {
    const perms = buildPatientPermissions({
      status: "Closed",
      linkedBillings: 1,
      linkedDuties: 0,
      linkedReceipts: 0
    });
    expect(perms.canHardDelete).toBe(false);
    expect(perms.blockReasons?.canHardDelete).toMatch(/billing/i);
  });

  it("allows hard delete when status is closed AND no linked rows", () => {
    const perms = buildPatientPermissions({
      status: "Closed",
      linkedBillings: 0,
      linkedDuties: 0,
      linkedReceipts: 0
    });
    expect(perms.canHardDelete).toBe(true);
    expect(perms.blockReasons?.canHardDelete).toBeUndefined();
  });
});
