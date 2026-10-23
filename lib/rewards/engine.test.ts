import { describe, it, expect } from "vitest";
import type { CardDef } from "./rules";
import { bestCard, evaluateCard, type RewardContext } from "./engine";
import type { RewardTag } from "./config";

// Fixture cards: a flat 1.5% card, a 5% rotating card (Q2 2026: dining + home
// improvement, $1,500/quarter cap) and a 2.6% dining/hotel card.
const flat: CardDef = {
  id: "flat",
  label: "Flat 1.5%",
  earnRules: { kind: "category", baseBps: 150, bonuses: {} },
};
const rotating: CardDef = {
  id: "rotating",
  label: "Rotating 5%",
  earnRules: {
    kind: "rotating",
    bonusBps: 500,
    baseBps: 100,
    schedule: { "2026-Q2": ["dining", "home_improvement"] },
    capCents: 150_000,
    capPeriod: "quarter",
  },
};
const travel: CardDef = {
  id: "travel",
  label: "Travel 2.6%",
  earnRules: { kind: "category", baseBps: 130, bonuses: { dining: 260, hotel: 260 } },
};
const cards = [flat, rotating, travel];

function ctx(
  overrides: Partial<RewardContext> & { rotatingCapRemaining?: number } = {},
): RewardContext {
  const { rotatingCapRemaining = 150_000, ...rest } = overrides;
  return {
    date: new Date("2026-05-15"),
    capRemaining: (_cardId, capKey) => (capKey === "rotating" ? rotatingCapRemaining : Infinity),
    ...rest,
  };
}

const tags = (...t: RewardTag[]) => new Set<RewardTag>(t);

describe("evaluateCard", () => {
  it("a card with no bonuses earns its base rate", () => {
    expect(evaluateCard(flat, tags("dining"), 10_000, ctx()).valueCents).toBe(150);
  });

  it("rotating earns 5% in an active category within cap", () => {
    const e = evaluateCard(rotating, tags("dining"), 10_000, ctx());
    expect(e.valueCents).toBe(500);
    expect(e.effectiveBps).toBe(500);
  });

  it("rotating earns only the base rate on an inactive category", () => {
    expect(evaluateCard(rotating, tags("grocery"), 10_000, ctx()).valueCents).toBe(100);
  });

  it("rotating falls back to the base rate once the cap is exhausted", () => {
    expect(evaluateCard(rotating, tags("dining"), 10_000, ctx({ rotatingCapRemaining: 0 })).valueCents).toBe(100);
  });

  it("rotating blends 5%/1% across the cap boundary", () => {
    // $100 purchase, only $40 of cap left: 5% on $40 + 1% on $60 = 200 + 60 = 260
    expect(
      evaluateCard(rotating, tags("dining"), 10_000, ctx({ rotatingCapRemaining: 4_000 })).valueCents,
    ).toBe(260);
  });

  it("rotating earns nothing extra in a quarter missing from its schedule", () => {
    expect(evaluateCard(rotating, tags("dining"), 10_000, ctx({ date: new Date("2026-08-01") })).valueCents).toBe(100);
  });

  it("category card applies its highest matching bonus", () => {
    expect(evaluateCard(travel, tags("dining"), 10_000, ctx()).valueCents).toBe(260);
    expect(evaluateCard(travel, tags("grocery"), 10_000, ctx()).valueCents).toBe(130);
  });
});

describe("bestCard", () => {
  it("picks the rotating card for an active-quarter category", () => {
    expect(bestCard(cards, tags("dining"), 10_000, ctx()).best.cardId).toBe("rotating");
  });

  it("picks the travel card for a hotel", () => {
    expect(bestCard(cards, tags("hotel"), 10_000, ctx()).best.cardId).toBe("travel");
  });

  it("once the rotating cap is gone, dining goes to the travel card", () => {
    expect(bestCard(cards, tags("dining"), 10_000, ctx({ rotatingCapRemaining: 0 })).best.cardId).toBe("travel");
  });

  it("an uncategorized purchase goes to the flat card", () => {
    expect(bestCard(cards, tags(), 10_000, ctx()).best.cardId).toBe("flat");
  });
});

describe("capped category bonuses", () => {
  const gold: CardDef = {
    id: "gold",
    label: "Gold",
    earnRules: {
      kind: "category",
      baseBps: 100,
      bonuses: { grocery: 400 },
      caps: { grocery: { cents: 600_000, period: "year" } },
    },
  };
  const withCap = (groceryRemaining: number): RewardContext =>
    ctx({ capRemaining: (_id, key) => (key === "grocery" ? groceryRemaining : Infinity) });

  it("earns the 4% bonus while under the cap", () => {
    expect(evaluateCard(gold, tags("grocery"), 10_000, withCap(600_000)).valueCents).toBe(400);
  });
  it("blends 4%/1% across the cap boundary ($40 left)", () => {
    // 4% on $40 + 1% on $60 = 160 + 60 = 220
    expect(evaluateCard(gold, tags("grocery"), 10_000, withCap(4_000)).valueCents).toBe(220);
  });
  it("falls back to base 1% once the cap is exhausted", () => {
    expect(evaluateCard(gold, tags("grocery"), 10_000, withCap(0)).valueCents).toBe(100);
  });
});
