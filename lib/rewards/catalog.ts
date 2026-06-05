import type { RewardTag } from "./config";

/**
 * Card earn-rule definitions modeled as data (§7), not branching code. Each
 * card maps to a Plaid account via `cards.account_id` (seeded separately). The
 * engine evaluates these rules against a transaction's reward tags.
 */

export type EarnRules =
  | {
      kind: "flat";
      currency: "cashback";
      bps: number; // basis points on everything
    }
  | {
      kind: "category";
      currency: "cashback";
      // User-defined cards: a base rate on everything, plus optional per-category
      // bonus rates (basis points), keyed by reward tag. The engine applies the
      // highest matching bonus for a purchase, else the base.
      baseBps: number;
      bonuses: Partial<Record<RewardTag, number>>;
    }
  | {
      kind: "rotating";
      currency: "cashback";
      // 5% on the quarter's active categories up to the cap, then baseBps; the
      // active categories + cap come from config/context, not stored here.
      bonusBps: number;
      baseBps: number;
    }
  | {
      kind: "tiered";
      currency: "miles";
      // Earn `bonusRate` miles/$ on `bonusTags`, else `baseRate` miles/$.
      bonusTags: RewardTag[];
      bonusRate: number;
      baseRate: number;
    };

export interface CardDef {
  id: string;
  label: string;
  network: string;
  /** Institution name substring used to map this card to a synced account. */
  institutionMatch: string;
  earnRules: EarnRules;
  cashbackMatchYearOne: boolean;
}

/** The three rewards cards from §7 (starting config; rates are editable data). */
export const CARD_CATALOG: CardDef[] = [
  {
    id: "quicksilver",
    label: "Capital One Quicksilver",
    network: "mastercard",
    institutionMatch: "Capital One",
    earnRules: { kind: "flat", currency: "cashback", bps: 150 },
    cashbackMatchYearOne: false,
  },
  {
    id: "discover-it",
    label: "Discover it Cash Back",
    network: "discover",
    institutionMatch: "Discover",
    earnRules: { kind: "rotating", currency: "cashback", bonusBps: 500, baseBps: 100 },
    cashbackMatchYearOne: false,
  },
  {
    id: "united-explorer",
    label: "Chase United MileagePlus Explorer",
    network: "visa",
    institutionMatch: "Chase",
    earnRules: {
      kind: "tiered",
      currency: "miles",
      bonusTags: ["united", "dining", "hotel"],
      bonusRate: 2,
      baseRate: 1,
    },
    cashbackMatchYearOne: false,
  },
];
