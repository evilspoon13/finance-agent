import { describe, it, expect } from "vitest";
import { projectMonthEnd } from "./projection";

describe("projectMonthEnd", () => {
  it("scales spend by the share of the month elapsed", () => {
    // Oct 10 of a 31-day month: $100 so far -> $310 pace.
    expect(projectMonthEnd(10_000, new Date("2026-10-10T12:00:00Z"))).toBe(31_000);
  });
  it("equals actual spend on the last day", () => {
    expect(projectMonthEnd(12_345, new Date("2026-02-28T23:00:00Z"))).toBe(12_345);
  });
});
