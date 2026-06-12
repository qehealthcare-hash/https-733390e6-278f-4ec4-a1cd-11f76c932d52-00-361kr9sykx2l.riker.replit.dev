import { describe, expect, it } from "vitest";
import { randomDigits } from "@/utils/secureRandom";

describe("randomDigits", () => {
  it("returns a string of the requested length", () => {
    const value = randomDigits(5);
    expect(value).toHaveLength(5);
    expect(/^\d{5}$/.test(value)).toBe(true);
  });
});
