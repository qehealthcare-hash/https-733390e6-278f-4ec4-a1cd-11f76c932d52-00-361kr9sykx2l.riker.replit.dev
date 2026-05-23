import { describe, expect, it } from "vitest";
import {
  canAssignCaretaker,
  canEditPatient,
  findActivePatientDuplicate,
  isActivePatient,
  patientAssignPatch,
  patientClosePatch,
  patientToApi,
  patientToRow
} from "@/business/patientRules";
import { patientSchema } from "@/validation/patientValidation";
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

  // Regression: the React form persists `disease_condition` and `start_date`
  // and those must survive the full PATCH → DB → GET round-trip. Migration
  // 017 added the columns; before that, both fields were silently dropped.
  it("round-trips disease_condition and start_date through schema → row → api", () => {
    const parsed = patientSchema.parse({
      name: "QA Patient",
      phone: "+919999000111",
      disease_condition: "Post-op care, knee replacement",
      start_date: "2026-05-23",
      relname: "Spouse"
    });
    const row = patientToRow(parsed);
    expect(row.disease_condition).toBe("Post-op care, knee replacement");
    expect(row.start_date).toBe("2026-05-23");

    const api = patientToApi({
      id: "PID1",
      name: row.name,
      phone: row.phone,
      disease_condition: row.disease_condition,
      start_date: row.start_date
    });
    expect(api.disease_condition).toBe("Post-op care, knee replacement");
    expect(api.start_date).toBe("2026-05-23");
  });

  it("clears disease_condition / start_date to empty string (never null) when missing", () => {
    const parsed = patientSchema.parse({
      name: "QA Patient",
      phone: "+919999000222",
      relname: "Spouse"
    });
    const row = patientToRow(parsed);
    expect(row.disease_condition).toBe("");
    expect(row.start_date).toBe("");
  });
});
