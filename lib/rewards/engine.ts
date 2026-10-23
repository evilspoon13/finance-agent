import { applyBps } from "@/lib/money";
import { quarterKey, type RewardTag } from "./config";
import type { CardDef, EarnRules } from "./rules";

/**
 * Pure rewards math. Given a transaction's reward tags + amount and a context
 * (the purchase date and a per-card cap lookup), compute each card's reward
 * value and pick the best.
 *
 * Spend caps are generic: `capRemaining(cardId, capKey)` returns the remaining
 * bonus-eligible cents for a card's capped bonus (capKey is a reward tag, or
 * "rotating"), or Infinity when uncapped. The caller (compute.ts) tracks cap
 * consumption chronologically from actual spend.
 */

export interface RewardContext {
  date: Date;
  capRemaining: (cardId: string, capKey: string) => number;
}

/** The reward tag a card's category rule applies to a purchase (highest bonus), or null. */
export function matchedCategoryTag(
  rules: Extract<EarnRules, { kind: "category" }>,
  tags: Set<RewardTag>,
): RewardTag | null {
  let bps = rules.baseBps;
  let chosen: RewardTag | null = null;
  for (const t of tags) {
    const bonus = rules.bonuses[t];
    if (bonus != null && bonus > bps) {
      bps = bonus;
      chosen = t;
    }
  }
  return chosen;
}

/** Active categories of a rotating card for the quarter containing `date`. */
export function rotatingActive(rules: Extract<EarnRules, { kind: "rotating" }>, date: Date): Set<RewardTag> {
  return new Set(rules.schedule[quarterKey(date)] ?? []);
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
  let value: number;
  const rules = card.earnRules;

  if (rules.kind === "category") {
    // Highest matching category bonus, else the base rate. If that bonus is
    // capped, only the under-cap portion earns the bonus; the rest earns base.
    const chosen = matchedCategoryTag(rules, tags);
    const bps = chosen ? (rules.bonuses[chosen] ?? rules.baseBps) : rules.baseBps;
    if (chosen && rules.caps?.[chosen]) {
      const eligible = Math.min(amountCents, ctx.capRemaining(card.id, chosen));
      value = applyBps(eligible, bps) + applyBps(amountCents - eligible, rules.baseBps);
    } else {
      value = applyBps(amountCents, bps);
    }
  } else {
    const active = rotatingActive(rules, ctx.date);
    const inBonus = [...tags].some((t) => active.has(t));
    const eligible = inBonus ? Math.min(amountCents, ctx.capRemaining(card.id, "rotating")) : 0;
    value = applyBps(eligible, rules.bonusBps) + applyBps(amountCents - eligible, rules.baseBps);
  }

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
