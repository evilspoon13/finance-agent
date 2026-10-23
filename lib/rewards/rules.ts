import type { RewardTag } from "./config";

/**
 * Card earn rules, modeled as data rather than branching code. Each card maps
 * to a synced credit account via `cards.account_id`; the engine evaluates these
 * rules against a transaction's reward tags. Rates are cash-back basis points —
 * points/miles cards are entered at the value the user assigns a point.
 */

/** Spend-cap window for a bonus rate. */
export type CapPeriod = "year" | "quarter" | "month";

/** A spend cap on a bonus: `cents` of bonus-eligible spend per `period`. */
export interface BonusCap {
  cents: number;
  period: CapPeriod;
}

export type EarnRules =
  | {
      // A base rate on everything, plus optional per-category bonus rates keyed
      // by reward tag. The engine applies the highest matching bonus, else the
      // base. `caps` optionally limits how much bonus-eligible spend a tag earns
      // per period (e.g. 6% groceries up to $6k/year), then it earns the base.
      kind: "category";
      baseBps: number;
      bonuses: Partial<Record<RewardTag, number>>;
      caps?: Partial<Record<RewardTag, BonusCap>>;
    }
  | {
      // `bonusBps` on the quarter's categories (from `schedule`, YYYY-Qn -> tags)
      // up to `capCents` per `capPeriod` (uncapped when absent), then `baseBps`.
      kind: "rotating";
      baseBps: number;
      bonusBps: number;
      schedule: Record<string, RewardTag[]>;
      capCents?: number;
      capPeriod?: CapPeriod;
    };

export interface CardDef {
  id: string;
  label: string;
  earnRules: EarnRules;
}
