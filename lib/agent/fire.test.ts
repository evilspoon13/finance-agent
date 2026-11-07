import { describe, expect, it } from "vitest";
import { savingsRatePct, yearsToTarget } from "./fire";
import { fiScenarios, grossSavingsRatePct, groupPaychecks, normalizedYear } from "./fire";

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

describe("groupPaychecks", () => {
  it("treats a check split across two accounts as one", () => {
    const d = (day: string, cents: number) => ({ date: new Date(`${day}T00:00:00Z`), cents });
    expect(groupPaychecks([d("2026-10-14", 143300), d("2026-10-28", 175900), d("2026-10-29", 117300)])).toEqual([143300, 293200]);
  });
});

describe("grossSavingsRatePct", () => {
  it("adds payroll HSA and divides by gross", () => {
    // October's close: saved $3,604, 2 checks, $63.51 other income.
    const rate = grossSavingsRatePct({ savedCents: 360400, otherIncomeCents: 6351, checks: 2, grossPerCheckCents: 443462, hsaPerCheckCents: 30500 });
    expect(rate).toBe(47.2);
  });
  it("is null without pay data", () => {
    expect(grossSavingsRatePct({ savedCents: 1, otherIncomeCents: 0, checks: 0, grossPerCheckCents: 0, hsaPerCheckCents: 0 })).toBeNull();
  });
});

describe("normalizedYear", () => {
  it("reproduces the hand formula from a usual paycheck", () => {
    const y = normalizedYear({
      netPerCheckCents: 143300,
      retirementPerCheckCents: 159200,
      hsaPerCheckCents: 30500,
      checksPerYear: 26,
      annualSpendCents: 5400000,
      plannedExtrasCents: 1750000,
    });
    expect(y.annualSavingsCents).toBe(5008000);
    expect(y.annualSavingsWithoutExtrasCents).toBe(3258000);
  });
});

describe("fiScenarios", () => {
  const s = fiScenarios({ investedCents: 2488300, annualSavingsCents: 5008000, annualSpendCents: 5400000, extrasCents: 1750000, age: 21, retirementAge: 60 });
  it("matches the agent's own figures: 17.0 years, 22.2 without RSU and bonus", () => {
    expect(s.baseYears).toBe(17);
    expect(s.levers[2]?.years).toBe(22.2);
    expect(s.levers[2]?.yearsSaved).toBe(-5.2);
  });
  it("counts a spending cut twice: it saves more and lowers the target", () => {
    expect(s.levers[0]?.yearsSaved).toBe(s.levers[1]?.yearsSaved); // $100 cut = $200 more saved
  });
  it("is slower at lower returns", () => {
    expect(s.byRealReturn[0]!.years!).toBeGreaterThan(s.byRealReturn[2]!.years!);
  });
  it("works out Coast FI", () => {
    expect(s.coastFi?.reached).toBe(false);
    expect(s.coastFi?.neededTodayCents).toBeGreaterThan(0);
  });
});
