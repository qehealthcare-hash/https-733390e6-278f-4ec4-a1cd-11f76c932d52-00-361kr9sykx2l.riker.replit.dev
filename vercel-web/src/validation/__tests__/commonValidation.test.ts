import { describe, expect, it } from "vitest";
import {
  normaliseDateString,
  optionalEmail,
  optionalIsoDate,
  optionalShiftType,
  optionalText
} from "@/validation/commonValidation";
import { patientSchema } from "@/validation/patientValidation";
import { employeeSchema } from "@/validation/employeeValidation";
import { inquirySchema } from "@/validation/inquiryValidation";

describe("normaliseDateString", () => {
  it("returns already-ISO YYYY-MM-DD unchanged", () => {
    expect(normaliseDateString("2026-05-22")).toBe("2026-05-22");
    expect(normaliseDateString("  2026-01-01  ")).toBe("2026-01-01");
  });

  it("converts the legacy 'D MMM YYYY' SPA format", () => {
    expect(normaliseDateString("9 May 2026")).toBe("2026-05-09");
    expect(normaliseDateString("1 Jan 2026")).toBe("2026-01-01");
    expect(normaliseDateString("31 Dec 2025")).toBe("2025-12-31");
  });

  it("falls back to Date.parse for ISO timestamps", () => {
    expect(normaliseDateString("2026-05-22T11:30:00.000Z")).toBe("2026-05-22");
  });

  it("returns empty string for nullish/blank input", () => {
    expect(normaliseDateString(null)).toBe("");
    expect(normaliseDateString(undefined)).toBe("");
    expect(normaliseDateString("")).toBe("");
    expect(normaliseDateString("   ")).toBe("");
  });

  it("returns the original string if it cannot be parsed", () => {
    expect(normaliseDateString("not a date")).toBe("not a date");
  });
});

describe("optionalIsoDate schema", () => {
  it("normalises legacy strings during zod parsing", () => {
    expect(optionalIsoDate.parse("9 May 2026")).toBe("2026-05-09");
    expect(optionalIsoDate.parse("2026-05-22")).toBe("2026-05-22");
  });

  it("defaults missing values to empty string", () => {
    expect(optionalIsoDate.parse(undefined)).toBe("");
  });
});

describe("optionalEmail / optionalShiftType / optionalText", () => {
  it("optionalEmail accepts blank, null and valid emails alike", () => {
    expect(optionalEmail.parse(undefined)).toBe("");
    expect(optionalEmail.parse(null)).toBe("");
    expect(optionalEmail.parse("")).toBe("");
    expect(optionalEmail.parse("   ")).toBe("");
    expect(optionalEmail.parse("USER@hominal.com")).toBe("user@hominal.com");
  });

  it("optionalShiftType coerces null/blank to undefined", () => {
    expect(optionalShiftType.parse(null)).toBeUndefined();
    expect(optionalShiftType.parse("")).toBeUndefined();
    expect(optionalShiftType.parse("DAY")).toBe("DAY");
  });

  it("optionalText coerces null/undefined to empty string", () => {
    expect(optionalText.parse(null)).toBe("");
    expect(optionalText.parse(undefined)).toBe("");
    expect(optionalText.parse("hello")).toBe("hello");
  });
});

/**
 * Regression coverage for the exact GET -> edit-one-field -> PATCH round
 * trip the React UI performs. Every field below comes back as either ""
 * or null from the API; the schemas must accept them without rejecting
 * the entire payload.
 */
describe("PATCH round-trip tolerance (regression)", () => {
  const patientRoundTrip = {
    id: "PIDD00100",
    name: "Round Trip Patient",
    full_name: "Round Trip Patient",
    phone: "+919998881111",
    mobile: "+919998881111",
    email: "", // blank email is legal — most rows don't have one
    shift_type: "", // refetch returns the empty default
    status: "Active",
    addr: "",
    address: "",
    area: "Ahmedabad",
    docs: null,
    photo: null
  };

  const employeeRoundTrip = {
    id: "EMP000000",
    fn: "Round",
    ln: "Trip",
    mn: "",
    phone: "+919998881111",
    mobile: "+919998881111",
    email: "",
    gender: "",
    dob: "",
    join_date: null, // GET surfaces null for unset dates
    leave_date: null,
    join: null,
    leave: null,
    shift: "",
    shift_type: "",
    status: "Active",
    docs: null
  };

  const inquiryRoundTrip = {
    id: "INQ0001",
    name: "Round Trip",
    phone: "+919998881111",
    email: "",
    source: "CALL",
    status: "New"
  };

  it("accepts a patient record refetched from the API", () => {
    expect(() => patientSchema.parse(patientRoundTrip)).not.toThrow();
  });

  it("accepts an employee record with null dates", () => {
    expect(() => employeeSchema.parse(employeeRoundTrip)).not.toThrow();
  });

  it("accepts an inquiry record refetched from the API", () => {
    expect(() => inquirySchema.parse(inquiryRoundTrip)).not.toThrow();
  });
});
