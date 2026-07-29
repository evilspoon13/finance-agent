import { describe, it, expect } from "vitest";
import { CARD_CATALOG, type CardDef } from "./catalog";
import { bestCard, evaluateCard, type RewardContext } from "./engine";
import { discoverCategoriesFor, MILES_VALUE_CENTS } from "./config";
import type { RewardTag } from "./config";

const cards = CARD_CATALOG;
const card = (id: string): CardDef => cards.find((c) => c.id === id)!;

function ctx(
  overrides: Partial<RewardContext> & { rotatingCapRemaining?: number } = {},
): RewardContext {
  const { rotatingCapRemaining = 150_000, ...rest } = overrides;
  return {
    date: new Date("2026-05-15"),
    discoverActive: new Set(discoverCategoriesFor(new Date("2026-05-15"))), // Q2: dining, home_improvement
    capRemaining: (_cardId, capKey) => (capKey === "rotating" ? rotatingCapRemaining : Infinity),
    milesValueCents: MILES_VALUE_CENTS,
    ...rest,
  };
}

const tags = (...t: RewardTag[]) => new Set<RewardTag>(t);

describe("evaluateCard", () => {
  it("Quicksilver earns flat 1.5%", () => {
    expect(evaluateCard(card("quicksilver"), tags(), 10_000, ctx()).valueCents).toBe(150);
  });

  it("Discover earns 5% in an active Q2 category (dining) within cap", () => {
    const e = evaluateCard(card("discover-it"), tags("dining"), 10_000, ctx());
    expect(e.valueCents).toBe(500);
    expect(e.effectiveBps).toBe(500);
  });

  it("Discover earns only 1% on a non-active category", () => {
    expect(evaluateCard(card("discover-it"), tags("grocery"), 10_000, ctx()).valueCents).toBe(100);
  });

  it("Discover falls back to 1% once the cap is exhausted", () => {
    const e = evaluateCard(card("discover-it"), tags("dining"), 10_000, ctx({ rotatingCapRemaining: 0 }));
    expect(e.valueCents).toBe(100);
  });

  it("Discover blends 5%/1% across the cap boundary", () => {
    // $100 purchase, only $40 of cap left: 5% on $40 + 1% on $60 = 200 + 60 = 260
    const e = evaluateCard(card("discover-it"), tags("dining"), 10_000, ctx({ rotatingCapRemaining: 4_000 }));
    expect(e.valueCents).toBe(260);
  });

  it("Cashback Match doubles Discover earnings when enabled", () => {
    const matched: CardDef = { ...card("discover-it"), cashbackMatchYearOne: true };
    expect(evaluateCard(matched, tags("dining"), 10_000, ctx()).valueCents).toBe(1000);
  });

  it("United earns 2x miles on dining, valued at miles rate", () => {
    // $100 dining * 2 miles/$ = 200 miles * 1.3c = 260c
    expect(evaluateCard(card("united-explorer"), tags("dining"), 10_000, ctx()).valueCents).toBe(260);
  });

  it("United earns 1x miles on a non-bonus category", () => {
    expect(evaluateCard(card("united-explorer"), tags("grocery"), 10_000, ctx()).valueCents).toBe(130);
  });
});

describe("bestCard", () => {
  it("picks Discover for a Q2 dining purchase (5% > 2.6% miles > 1.5%)", () => {
    const { best } = bestCard(cards, tags("dining"), 10_000, ctx());
    expect(best.cardId).toBe("discover-it");
  });

  it("picks United for a flight (2x miles 2.6% > Quicksilver 1.5%, dining not active for flights)", () => {
    // flights are NOT a Q2 Discover category, so Discover = 1%. United 1x on
    // flights (flights isn't a United bonus tag) = 1.3%, Quicksilver = 1.5%.
    const { best } = bestCard(cards, tags("flights"), 10_000, ctx());
    expect(best.cardId).toBe("quicksilver");
  });

  it("picks United for a hotel (2x miles = 2.6% beats Quicksilver 1.5%)", () => {
    const { best } = bestCard(cards, tags("hotel"), 10_000, ctx());
    expect(best.cardId).toBe("united-explorer");
  });

  it("picks Discover for home improvement in Q2", () => {
    const { best } = bestCard(cards, tags("home_improvement"), 10_000, ctx());
    expect(best.cardId).toBe("discover-it");
  });

  it("once Discover cap is gone, dining goes to United (2.6%) over Quicksilver (1.5%)", () => {
    const { best } = bestCard(cards, tags("dining"), 10_000, ctx({ rotatingCapRemaining: 0 }));
    expect(best.cardId).toBe("united-explorer");
  });

  it("uncategorized purchase goes to Quicksilver flat 1.5%", () => {
    const { best } = bestCard(cards, tags(), 10_000, ctx());
    expect(best.cardId).toBe("quicksilver");
  });
});

describe("capped category bonuses", () => {
  const gold: CardDef = {
    id: "gold",
    label: "Gold",
    network: "amex",
    institutionMatch: "",
    cashbackMatchYearOne: false,
    earnRules: {
      kind: "category",
      currency: "cashback",
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

describe("per-card rotating schedule", () => {
  // Card's OWN schedule (grocery in Q2) overrides the global Discover config
  // (dining/home_improvement in Q2).
  const flex: CardDef = {
    id: "flex",
    label: "Freedom Flex",
    network: "visa",
    institutionMatch: "",
    cashbackMatchYearOne: false,
    earnRules: {
      kind: "rotating",
      currency: "cashback",
      bonusBps: 500,
      baseBps: 100,
      schedule: { "2026-Q2": ["grocery"] },
      capCents: 150_000,
      capPeriod: "quarter",
    },
  };

  it("earns 5% on its own active category (grocery)", () => {
    expect(evaluateCard(flex, tags("grocery"), 10_000, ctx()).valueCents).toBe(500);
  });
  it("earns only 1% on a category active globally but not on its own schedule (dining)", () => {
    expect(evaluateCard(flex, tags("dining"), 10_000, ctx()).valueCents).toBe(100);
  });
});
