import { describe, expect, it } from "vitest";
import { sanitizeCsvCell } from "@/lib/csv";

describe("csv export helpers", () => {
  it("escapes formula-injection prefixes", () => {
    expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvCell("+919876543210")).toBe("'+919876543210");
    expect(sanitizeCsvCell("-amount")).toBe("'-amount");
    expect(sanitizeCsvCell("@sum")).toBe("'@sum");
    expect(sanitizeCsvCell("normal text")).toBe("normal text");
  });
});
