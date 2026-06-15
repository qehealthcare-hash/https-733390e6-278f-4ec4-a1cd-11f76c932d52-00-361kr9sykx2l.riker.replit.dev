import { describe, expect, it } from "vitest";
import {
  clampMoneyNonNegative,
  moneyNumber,
  moneyOutstanding,
  parseMoney,
  roundMoney,
  sumMoney
} from "@/utils/money";

describe("money utils", () => {
  it("roundMoney handles float drift", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney("150.555")).toBe(150.56);
  });

  it("moneyNumber coerces invalid input to 0", () => {
    expect(moneyNumber("")).toBe(0);
    expect(moneyNumber(null)).toBe(0);
    expect(moneyNumber(undefined)).toBe(0);
    expect(moneyNumber("bad")).toBe(0);
  });

  it("sumMoney rounds once at the end", () => {
    expect(sumMoney([10.1, 10.2, 10.3])).toBe(30.6);
    expect(sumMoney(["100", 50])).toBe(150);
  });

  it("parseMoney matches roundMoney", () => {
    expect(parseMoney("42.5")).toBe(42.5);
  });

  it("clampMoneyNonNegative floors negatives", () => {
    expect(clampMoneyNonNegative(-12.345)).toBe(0);
    expect(clampMoneyNonNegative(12.345)).toBe(12.35);
  });

  it("moneyOutstanding never returns negative", () => {
    expect(moneyOutstanding(100, 150)).toBe(0);
    expect(moneyOutstanding(100.5, 40.25)).toBe(60.25);
  });
});
