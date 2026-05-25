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

  it("uppercases PAN on parse", () => {
    const lower = employeeSchema.parse({ ...base, pan: "abcde1234f" });
    expect(lower.pan).toBe("ABCDE1234F");
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

describe("employeeSchema — legacy shift / shift_type labels", () => {
  const base = {
    fn: "Anil",
    ln: "Kumar",
    phone: "9876543210"
  };

  it("accepts the legacy SPA label 'Day Shift (9:00 AM – 7:00 PM)'", () => {
    const parsed = employeeSchema.parse({ ...base, shift: "Day Shift (9:00 AM – 7:00 PM)" });
    expect(parsed.shift).toBe("DAY");
    expect(parsed.shift_type).toBe("DAY");
  });

  it("normalises '24 Hours Shift' to 24H", () => {
    const parsed = employeeSchema.parse({ ...base, shift: "24 Hours Shift" });
    expect(parsed.shift_type).toBe("24H");
  });

  it("normalises 'Night Shift (8:00 PM – 8:00 AM)' to NIGHT", () => {
    const parsed = employeeSchema.parse({ ...base, shift_type: "Night Shift (8:00 PM – 8:00 AM)" });
    expect(parsed.shift_type).toBe("NIGHT");
  });

  it("defaults to DAY when shift is empty", () => {
    const parsed = employeeSchema.parse({ ...base });
    expect(parsed.shift_type).toBe("DAY");
  });

  it("accepts an unrecognised legacy label without crashing (falls back to DAY)", () => {
    const parsed = employeeSchema.parse({ ...base, shift: "Some legacy label" });
    expect(parsed.shift_type).toBe("DAY");
  });
});

describe("employeeSchema — round-tripping legacy rows without join_date", () => {
  it("accepts a record with empty join_date / leave_date", () => {
    const parsed = employeeSchema.parse({
      fn: "Legacy",
      ln: "Worker",
      phone: "9876543210",
      join_date: "",
      leave_date: ""
    });
    expect(parsed.join_date).toBe("");
    expect(parsed.leave_date).toBe("");
  });

  it("accepts null dates round-tripped from GET responses", () => {
    const parsed = employeeSchema.parse({
      fn: "Legacy",
      ln: "Worker",
      phone: "9876543210",
      join_date: null,
      leave_date: null
    });
    expect(parsed.join_date).toBe("");
    expect(parsed.leave_date).toBe("");
  });

  it("normalises mobile annotations like '7874751265(son)'", () => {
    const parsed = employeeSchema.parse({
      fn: "Legacy",
      ln: "Worker",
      phone: "7874751265(son)"
    });
    expect(parsed.phone).toBe("7874751265");
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
