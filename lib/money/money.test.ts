import { describe, it, expect } from "vitest";
import { dollarsToCents, centsToDollars, formatCents, applyBps, sumCents } from "./index";

describe("dollarsToCents", () => {
  it("converts whole and fractional dollars", () => {
    expect(dollarsToCents(12.34)).toBe(1234);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(-5)).toBe(-500);
  });

  it("absorbs float representation error by rounding", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in floats
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it("throws on non-finite input", () => {
    expect(() => dollarsToCents(NaN)).toThrow();
    expect(() => dollarsToCents(Infinity)).toThrow();
  });

  it("round-trips through centsToDollars", () => {
    for (const d of [0, 0.01, 12.34, 1000, -7.5]) {
      expect(centsToDollars(dollarsToCents(d))).toBeCloseTo(d, 5);
    }
  });
});

describe("formatCents", () => {
  it("formats positive, zero, and negative cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-500)).toBe("-$5.00");
  });

  it("respects signDisplay always", () => {
    expect(formatCents(500, { signDisplay: "always" })).toBe("+$5.00");
  });

  it("throws on non-integer cents", () => {
    expect(() => formatCents(1.5)).toThrow();
  });
});

describe("applyBps", () => {
  it("applies a basis-points rate and rounds to integer cents", () => {
    expect(applyBps(10000, 150)).toBe(150); // 1.5% of $100 = $1.50
    expect(applyBps(1999, 500)).toBe(100); // 5% of $19.99 = $0.99995 -> 100
  });
});

describe("sumCents", () => {
  it("sums integer cents", () => {
    expect(sumCents([100, 200, -50])).toBe(250);
    expect(sumCents([])).toBe(0);
  });

  it("throws if any value is non-integer", () => {
    expect(() => sumCents([100, 0.5])).toThrow();
  });
});
