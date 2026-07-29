import { describe, it, expect } from "vitest";
import { suggestionToEarnRules, type CardRewardSuggestion } from "./card-rewards";

const base: CardRewardSuggestion = {
  currency: "cashback",
  baseRatePct: 1,
  bonuses: [],
  rotating: null,
  annualFee: null,
  signupBonus: null,
  cashbackMatchYearOne: false,
  notes: "",
  confidence: "high",
};

describe("suggestionToEarnRules", () => {
  it("maps category bonuses + caps to a capped category rule", () => {
    const r = suggestionToEarnRules({
      ...base,
      baseRatePct: 1,
      bonuses: [
        { category: "grocery", ratePct: 4, capAmount: 25000, capPeriod: "year" },
        { category: "dining", ratePct: 4 },
      ],
      annualFee: 250,
    });
    expect(r.earnRules.kind).toBe("category");
    if (r.earnRules.kind === "category") {
      expect(r.earnRules.baseBps).toBe(100);
      expect(r.earnRules.bonuses.grocery).toBe(400);
      expect(r.earnRules.bonuses.dining).toBe(400);
      expect(r.earnRules.caps?.grocery).toEqual({ cents: 2_500_000, period: "year" });
      expect(r.earnRules.caps?.dining).toBeUndefined(); // no cap given
    }
    expect(r.annualFeeCents).toBe(25_000);
  });

  it("maps a rotating card to a rotating rule with its own schedule", () => {
    const r = suggestionToEarnRules({
      ...base,
      baseRatePct: 1,
      rotating: {
        bonusRatePct: 5,
        capAmount: 1500,
        capPeriod: "quarter",
        quarters: [{ quarter: "2026-Q2", categories: ["dining", "home_improvement"] }],
      },
    });
    expect(r.earnRules.kind).toBe("rotating");
    if (r.earnRules.kind === "rotating") {
      expect(r.earnRules.bonusBps).toBe(500);
      expect(r.earnRules.baseBps).toBe(100);
      expect(r.earnRules.capCents).toBe(150_000);
      expect(r.earnRules.schedule?.["2026-Q2"]).toEqual(["dining", "home_improvement"]);
    }
  });

  it("carries cashback-match and treats points rate as a cashback-equivalent %", () => {
    const r = suggestionToEarnRules({
      ...base,
      currency: "points",
      baseRatePct: 1,
      bonuses: [{ category: "dining", ratePct: 3 }],
      cashbackMatchYearOne: true,
    });
    expect(r.cashbackMatchYearOne).toBe(true);
    if (r.earnRules.kind === "category") expect(r.earnRules.bonuses.dining).toBe(300);
  });
});
