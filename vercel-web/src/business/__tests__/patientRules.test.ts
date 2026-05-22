import { describe, expect, it } from "vitest";
import {
  canAssignCaretaker,
  canEditPatient,
  findActivePatientDuplicate,
  isActivePatient,
  patientAssignPatch,
  patientClosePatch
} from "@/business/patientRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("patientRules — workflow matrix", () => {
  it("treats missing status as Active for legacy rows", () => {
    expect(isActivePatient(undefined)).toBe(true);
    expect(isActivePatient("Active")).toBe(true);
    expect(isActivePatient("Closed")).toBe(false);
  });

  it("blocks edits on Closed patients", () => {
    expectFail(canEditPatient("Closed"), ErrorCodes.business);
    expectOk(canEditPatient("Active"));
  });

  it("blocks caretaker assignment when patient is inactive", () => {
    expectFail(canAssignCaretaker("Closed"), ErrorCodes.business);
    expectOk(canAssignCaretaker("Active"));
  });

  it("close patch sets status to Closed and stamps actor", () => {
    expect(patientClosePatch("admin@hominal.test")).toEqual({
      status: "Closed",
      updated_by: "admin@hominal.test"
    });
  });

  it("assign patch carries caretaker + shift", () => {
    expect(patientAssignPatch("EMP1", "DAY", "admin@hominal.test")).toEqual({
      caretaker_id: "EMP1",
      shift: "DAY",
      updated_by: "admin@hominal.test"
    });
  });

  it("flags duplicate ACTIVE patient by phone suffix", () => {
    const list = [
      { id: "PID1", phone: "+919876543210", status: "Active" },
      { id: "PID2", phone: "9876500000", status: "Closed" }
    ];
    expect(findActivePatientDuplicate(list, "9876543210")?.id).toBe("PID1");
    expect(findActivePatientDuplicate(list, "9876543210", "PID1")).toBeNull();
    expect(findActivePatientDuplicate(list, "9876500000")).toBeNull();
  });
});
