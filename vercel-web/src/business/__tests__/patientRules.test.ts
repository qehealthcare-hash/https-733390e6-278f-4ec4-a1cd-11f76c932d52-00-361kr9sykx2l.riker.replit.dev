import { describe, expect, it } from "vitest";
import {
  canAssignCaretaker,
  canEditPatient,
  canHardDeletePatient,
  canReopenPatient,
  findActivePatientByName,
  findActivePatientDuplicate,
  isActivePatient,
  patientAssignPatch,
  patientClosePatch,
  patientNameKey,
  patientReopenPatch,
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
    expectOk(canEditPatient("Duty Closed"));
    expectOk(canEditPatient("Deceased"));
  });

  it("blocks caretaker assignment when patient is inactive", () => {
    expectFail(canAssignCaretaker("Closed"), ErrorCodes.business);
    expectOk(canAssignCaretaker("Active"));
  });

  it("close patch sets status to Closed and stamps actor", () => {
    expect(patientClosePatch("admin@hominal.test")).toEqual({
      status: "Closed",
      status_reason: "",
      status_reason_other: "",
      updated_by: "admin@hominal.test"
    });
  });

  it("close patch persists close reason and other-note", () => {
    expect(
      patientClosePatch("admin@hominal.test", "Other", "Family stopped service")
    ).toEqual({
      status: "Closed",
      status_reason: "Other",
      status_reason_other: "Family stopped service",
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

  // Regression: the React form persists `age`, `disease_condition` and
  // `start_date`, and they must survive the full PATCH → DB → GET round-trip.
  // Migrations 017 + 018 added the columns; before that, every field was
  // silently dropped because patientToRow did not write them.
  it("round-trips age, disease_condition and start_date through schema → row → api", () => {
    const parsed = patientSchema.parse({
      name: "QA Patient",
      phone: "+919999000111",
      age: "62",
      disease_condition: "Post-op care, knee replacement",
      start_date: "2026-05-23",
      relname: "Spouse"
    });
    const row = patientToRow(parsed);
    expect(row.age).toBe("62");
    expect(row.disease_condition).toBe("Post-op care, knee replacement");
    expect(row.start_date).toBe("2026-05-23");

    const api = patientToApi({
      id: "PID1",
      name: row.name,
      phone: row.phone,
      age: row.age,
      disease_condition: row.disease_condition,
      start_date: row.start_date
    });
    expect(api.age).toBe("62");
    expect(api.disease_condition).toBe("Post-op care, knee replacement");
    expect(api.start_date).toBe("2026-05-23");
  });

  it("clears age / disease_condition / start_date to empty string (never null) when missing", () => {
    const parsed = patientSchema.parse({
      name: "QA Patient",
      phone: "+919999000222",
      relname: "Spouse"
    });
    const row = patientToRow(parsed);
    expect(row.age).toBe("");
    expect(row.disease_condition).toBe("");
    expect(row.start_date).toBe("");
  });
});

describe("patientRules — name duplicate guard", () => {
  it("normalises case + whitespace into a stable key", () => {
    expect(patientNameKey("  Kundanben  Shah ")).toBe("kundanben shah");
    expect(patientNameKey("kundanben shah")).toBe("kundanben shah");
    expect(patientNameKey("KUNDANBEN SHAH")).toBe("kundanben shah");
    expect(patientNameKey("")).toBe("");
    expect(patientNameKey(null)).toBe("");
  });

  it("flags an active patient with the same name (different phone)", () => {
    const hit = findActivePatientByName(
      [
        { id: "PID1002", name: "kundanben shah", phone: "9898044407", status: "Active" },
        { id: "PID1003", name: "Other Person", phone: "9000000000", status: "Active" }
      ],
      "Kundanben SHAH"
    );
    expect(hit?.id).toBe("PID1002");
  });

  it("ignores Closed patients and excludeId", () => {
    expect(
      findActivePatientByName(
        [{ id: "PID1002", name: "kundanben shah", phone: "x", status: "Closed" }],
        "kundanben shah"
      )
    ).toBeNull();
    expect(
      findActivePatientByName(
        [{ id: "PID1002", name: "kundanben shah", phone: "x", status: "Active" }],
        "kundanben shah",
        "PID1002"
      )
    ).toBeNull();
  });

  it("returns null when name is empty", () => {
    expect(
      findActivePatientByName(
        [{ id: "PID1002", name: "kundanben shah", phone: "x", status: "Active" }],
        ""
      )
    ).toBeNull();
  });
});

describe("patientRules — reopen + hard delete", () => {
  it("reopen patch flips status back to Active and clears close reason", () => {
    expect(patientReopenPatch("admin@hominal.test")).toEqual({
      status: "Active",
      status_reason: "",
      status_reason_other: "",
      updated_by: "admin@hominal.test"
    });
  });

  it("canReopen blocks already-Active patients", () => {
    expectFail(canReopenPatient("Active"), ErrorCodes.business);
    expectFail(canReopenPatient(undefined), ErrorCodes.business);
    expectFail(canReopenPatient(null), ErrorCodes.business);
  });

  it("canReopen allows Closed / On Hold / legacy inactive statuses", () => {
    expectOk(canReopenPatient("Closed"));
    expectOk(canReopenPatient("On Hold"));
    expectOk(canReopenPatient("Duty Closed"));
    expectOk(canReopenPatient("Deceased"));
  });

  it("canHardDelete refuses Active patients", () => {
    expectFail(
      canHardDeletePatient("Active", { billings: 0, duties: 0, receipts: 0 }),
      ErrorCodes.business
    );
  });

  it("canHardDelete refuses Closed patients with linked rows", () => {
    expectFail(
      canHardDeletePatient("Closed", { billings: 2, duties: 0, receipts: 0 }),
      ErrorCodes.business
    );
    expectFail(
      canHardDeletePatient("Closed", { billings: 0, duties: 1, receipts: 0 }),
      ErrorCodes.business
    );
    expectFail(
      canHardDeletePatient("Closed", { billings: 0, duties: 0, receipts: 3 }),
      ErrorCodes.business
    );
  });

  it("canHardDelete permits Closed patient with no linked rows", () => {
    expectOk(canHardDeletePatient("Closed", { billings: 0, duties: 0, receipts: 0 }));
    expectOk(canHardDeletePatient("Deceased", { billings: 0, duties: 0, receipts: 0 }));
  });
});
