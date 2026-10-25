import { describe, expect, it } from "vitest";
import { savingsRatePct, yearsToTarget } from "./fire";

describe("yearsToTarget", () => {
  it("is 0 when the target is already met", () => {
    expect(yearsToTarget(1_000_000, 0, 900_000)).toBe(0);
  });

  it("matches the closed-form future value", () => {
    const n = yearsToTarget(50_000, 40_000, 1_500_000, 0.05)!;
    const fv = 50_000 * 1.05 ** n + 40_000 * ((1.05 ** n - 1) / 0.05);
    expect(fv).toBeCloseTo(1_500_000, 0);
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(21);
  });

  it("handles a zero return and no savings", () => {
    expect(yearsToTarget(0, 10_000, 100_000, 0)).toBe(10);
    expect(yearsToTarget(0, 0, 100_000)).toBeNull();
  });

  it("grows a portfolio with no new savings", () => {
    expect(yearsToTarget(100_000, 0, 200_000, 0.05)).toBeCloseTo(Math.log(2) / Math.log(1.05), 6);
  });
});

describe("savingsRatePct", () => {
  it("is the share of income not spent", () => {
    expect(savingsRatePct(10_000, 6_000)).toBe(40);
    expect(savingsRatePct(3_000, 4_000)).toBe(-33.3);
    expect(savingsRatePct(0, 100)).toBeNull();
  });
});
