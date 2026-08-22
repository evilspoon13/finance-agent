import type { RewardTag } from "./config";

/**
 * Derive the reward category tags a transaction qualifies for, from Plaid's
 * personal_finance_category plus merchant-name heuristics (Plaid's taxonomy
 * doesn't distinguish wholesale clubs, streaming, EV charging, the airline,
 * etc., which the card rules need).
 */

export interface TaggableTxn {
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
  merchantName?: string | null;
  name?: string | null;
}

// Plaid PFC detailed/primary -> reward tags.
const PFC_DETAILED_TAGS: Record<string, RewardTag[]> = {
  FOOD_AND_DRINK_RESTAURANT: ["dining"],
  FOOD_AND_DRINK_FAST_FOOD: ["dining"],
  FOOD_AND_DRINK_COFFEE: ["dining"],
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: ["dining"],
  FOOD_AND_DRINK_GROCERIES: ["grocery"],
  TRANSPORTATION_GAS: ["gas"],
  TRANSPORTATION_PUBLIC_TRANSIT: ["transit"],
  TRAVEL_FLIGHTS: ["flights"],
  TRAVEL_LODGING: ["hotel"],
};

const PFC_PRIMARY_TAGS: Record<string, RewardTag[]> = {
  HOME_IMPROVEMENT: ["home_improvement"],
};

// Merchant-name substring (lowercased) -> reward tags.
const MERCHANT_TAGS: { match: string[]; tags: RewardTag[] }[] = [
  { match: ["costco", "sam's club", "sams club", "bj's", "bj wholesale"], tags: ["wholesale_club"] },
  {
    match: [
      "netflix",
      "spotify",
      "hulu",
      "disney+",
      "disney plus",
      "hbo",
      "max.com",
      "youtube premium",
      "paramount+",
      "peacock",
      "apple music",
      "apple tv",
    ],
    tags: ["streaming"],
  },
  // Co-branded United earning covers tickets, inflight purchases and United
  // Club — but NOT lookalikes ("United Healthcare"), so never match bare "united".
  {
    match: ["united airlines", "unitedairlines", "united air", "united.com", "ual ", "mileageplus", "united club"],
    tags: ["united", "flights"],
  },
  {
    match: ["tesla supercharger", "chargepoint", "evgo", "electrify america"],
    tags: ["ev_charging"],
  },
  { match: ["cvs", "walgreens", "rite aid", "duane reade"], tags: ["drugstore"] },
];

export function deriveTags(txn: TaggableTxn): Set<RewardTag> {
  const tags = new Set<RewardTag>();

  const detailed = txn.pfcDetailed ?? "";
  for (const t of PFC_DETAILED_TAGS[detailed] ?? []) tags.add(t);

  const primary = txn.pfcPrimary ?? "";
  for (const t of PFC_PRIMARY_TAGS[primary] ?? []) tags.add(t);

  const haystack = `${txn.merchantName ?? ""} ${txn.name ?? ""}`.toLowerCase();
  for (const { match, tags: ts } of MERCHANT_TAGS) {
    if (match.some((m) => haystack.includes(m))) for (const t of ts) tags.add(t);
  }

  return tags;
}
