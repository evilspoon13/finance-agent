import { describe, it, expect } from "vitest";
import { parseCardForm } from "./card-form";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("parseCardForm", () => {
  it("parses a category card with a capped bonus", () => {
    const card = parseCardForm(
      form([
        ["label", "Gold"],
        ["accountId", ""],
        ["kind", "category"],
        ["baseRate", "1"],
        ["bonus_dining", "4"],
        ["bonus_grocery", "4"],
        ["cap_grocery", "25000"],
        ["capPeriod_grocery", "year"],
        ["bonus_gas", ""],
        ["annualFee", "250"],
        ["notes", "  "],
      ]),
    );
    expect(card).toEqual({
      label: "Gold",
      accountId: null,
      earnRules: {
        kind: "category",
        baseBps: 100,
        bonuses: { dining: 400, grocery: 400 },
        caps: { grocery: { cents: 2_500_000, period: "year" } },
      },
      annualFeeCents: 25_000,
      signupBonus: null,
      notes: null,
    });
  });

  it("parses a rotating card, keeping every quarter on the schedule", () => {
    const card = parseCardForm(
      form([
        ["label", "Rotating"],
        ["accountId", "acct_1"],
        ["kind", "rotating"],
        ["baseRate", "1"],
        ["bonusRate", "5"],
        ["rotCap", "1500"],
        ["rotCapPeriod", "quarter"],
        ["sched_2026-Q4", "dining"],
        ["sched_2026-Q4", "drugstore"],
        ["sched_2026-Q1", "grocery"],
        ["sched_bogus", "dining"],
        ["sched_2026-Q3", "not-a-tag"],
      ]),
    );
    expect(card?.earnRules).toEqual({
      kind: "rotating",
      baseBps: 100,
      bonusBps: 500,
      schedule: { "2026-Q4": ["dining", "drugstore"], "2026-Q1": ["grocery"] },
      capCents: 150_000,
      capPeriod: "quarter",
    });
    expect(card?.accountId).toBe("acct_1");
  });

  it("rejects a card without a name or base rate", () => {
    expect(parseCardForm(form([["baseRate", "1"]]))).toBeNull();
    expect(parseCardForm(form([["label", "X"], ["baseRate", "abc"]]))).toBeNull();
  });
});
