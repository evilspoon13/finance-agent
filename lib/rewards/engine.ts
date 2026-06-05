import { applyBps } from "@/lib/money";
import type { RewardTag } from "./config";
import type { CardDef } from "./catalog";

/**
 * Pure rewards math. Given a transaction's reward tags + amount and a context
 * (this quarter's Discover categories, remaining Discover cap, miles value),
 * compute each card's reward value and pick the best.
 */

export interface RewardContext {
  discoverActive: Set<RewardTag>;
  discoverCapRemainingCents: number;
  milesValueCents: number;
}

export interface CardEval {
  cardId: string;
  valueCents: number; // reward value earned on this purchase
  effectiveBps: number; // value / amount, in basis points
}

/** Reward value (cents) a single card earns on a purchase of `amountCents`. */
export function evaluateCard(
  card: CardDef,
  tags: Set<RewardTag>,
  amountCents: number,
  ctx: RewardContext,
): CardEval {
  let value = 0;
  const rules = card.earnRules;

  if (rules.kind === "flat") {
    value = applyBps(amountCents, rules.bps);
  } else if (rules.kind === "category") {
    // Highest matching category bonus, else the base rate.
    let bps = rules.baseBps;
    for (const t of tags) {
      const bonus = rules.bonuses[t];
      if (bonus != null && bonus > bps) bps = bonus;
    }
    value = applyBps(amountCents, bps);
  } else if (rules.kind === "rotating") {
    const inBonus =
      ctx.discoverCapRemainingCents > 0 && [...tags].some((t) => ctx.discoverActive.has(t));
    const eligible = inBonus ? Math.min(amountCents, ctx.discoverCapRemainingCents) : 0;
    value = applyBps(eligible, rules.bonusBps) + applyBps(amountCents - eligible, rules.baseBps);
  } else {
    // tiered miles
    const rate = [...tags].some((t) => rules.bonusTags.includes(t)) ? rules.bonusRate : rules.baseRate;
    const miles = (amountCents / 100) * rate;
    value = Math.round(miles * ctx.milesValueCents);
  }

  // First-year Cashback Match doubles cash-back earnings for value comparison.
  if (card.cashbackMatchYearOne && rules.kind !== "tiered") value *= 2;

  const effectiveBps = amountCents > 0 ? Math.round((value / amountCents) * 10_000) : 0;
  return { cardId: card.id, valueCents: value, effectiveBps };
}

export interface BestCard {
  best: CardEval;
  all: CardEval[];
}

/** Evaluate all cards and return the highest-value one (stable on ties). */
export function bestCard(
  cards: CardDef[],
  tags: Set<RewardTag>,
  amountCents: number,
  ctx: RewardContext,
): BestCard {
  const all = cards.map((c) => evaluateCard(c, tags, amountCents, ctx));
  let best = all[0]!;
  for (const e of all) if (e.valueCents > best.valueCents) best = e;
  return { best, all };
}
