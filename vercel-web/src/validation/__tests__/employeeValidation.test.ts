import { describe, expect, it } from "vitest";
import { employeeSchema, employeeStatusSchema } from "@/validation/employeeValidation";

describe("employeeSchema — identity & contact fields", () => {
  const base = {
    fn: "Anil",
    ln: "Kumar",
    phone: "9876543210",
    gender: "Male",
    dob: "1990-01-01"
  };

  it("accepts a minimal valid record", () => {
    const parsed = employeeSchema.parse(base);
    expect(parsed.fn).toBe("Anil");
    expect(parsed.phone).toBe("9876543210");
  });

  it("rejects records without any name part", () => {
    expect(() =>
      employeeSchema.parse({ ...base, fn: undefined, ln: undefined })
    ).toThrow();
  });

  it("rejects mobile shorter than 10 digits", () => {
    expect(() => employeeSchema.parse({ ...base, phone: "98765" })).toThrow();
  });

  it("accepts a 12-digit Aadhar with internal spaces (normalised downstream)", () => {
    const parsed = employeeSchema.parse({ ...base, aadhar: "1234 5678 9012" });
    expect(parsed.aadhar.replace(/\s/g, "")).toBe("123456789012");
  });

  it("rejects Aadhar that is not 12 digits after normalisation", () => {
    expect(() => employeeSchema.parse({ ...base, aadhar: "1234 5678" })).toThrow();
  });

  it("accepts a valid PAN in either case (uppercased downstream)", () => {
    const lower = employeeSchema.parse({ ...base, pan: "abcde1234f" });
    expect(lower.pan.toUpperCase()).toBe("ABCDE1234F");
    const upper = employeeSchema.parse({ ...base, pan: "ABCDE1234F" });
    expect(upper.pan).toBe("ABCDE1234F");
  });

  it("rejects malformed PAN values", () => {
    expect(() => employeeSchema.parse({ ...base, pan: "ABC123" })).toThrow();
  });
});

describe("employeeSchema — joining vs leave date", () => {
  it("rejects a leave_date earlier than join_date", () => {
    expect(() =>
      employeeSchema.parse({
        fn: "A",
        ln: "B",
        phone: "9876543210",
        gender: "Male",
        dob: "1990-01-01",
        join_date: "2024-05-01",
        leave_date: "2024-04-01"
      })
    ).toThrow();
  });

  it("accepts a leave_date on or after join_date", () => {
    const ok = employeeSchema.parse({
      fn: "A",
      ln: "B",
      phone: "9876543210",
      gender: "Male",
      dob: "1990-01-01",
      join_date: "2024-04-01",
      leave_date: "2024-05-01"
    });
    expect(ok.leave_date).toBe("2024-05-01");
  });
});

describe("employeeStatusSchema — status transitions", () => {
  it("accepts a status with no reason (defaults to empty)", () => {
    const parsed = employeeStatusSchema.parse({ status: "Active" });
    expect(parsed.status).toBe("Active");
    expect(parsed.reason).toBe("");
  });

  it("accepts a reason note up to 500 chars", () => {
    const long = "x".repeat(500);
    const parsed = employeeStatusSchema.parse({ status: "OnLeave", reason: long });
    expect(parsed.reason?.length).toBe(500);
  });

  it("rejects unknown status values", () => {
    expect(() => employeeStatusSchema.parse({ status: "Vacation" })).toThrow();
  });
});
