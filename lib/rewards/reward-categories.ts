import type { RewardTag } from "./config";

/**
 * Reward categories a user can set a bonus rate on, in the card manager. These
 * are the tags `deriveTags()` can actually assign to a transaction (see
 * tags.ts) — offering a rate for an undetectable tag would never pay out.
 * "united" is airline-specific but included: co-branded airline cards bonus
 * their own airline only, and without the tag that rule could only be
 * expressed as an all-airline "flights" bonus, which overstates it.
 */
export const REWARD_CATEGORIES: { tag: RewardTag; label: string }[] = [
  { tag: "dining", label: "Dining & restaurants" },
  { tag: "grocery", label: "Groceries" },
  { tag: "wholesale_club", label: "Wholesale clubs" },
  { tag: "gas", label: "Gas" },
  { tag: "ev_charging", label: "EV charging" },
  { tag: "transit", label: "Transit" },
  { tag: "flights", label: "Flights (any airline)" },
  { tag: "united", label: "United Airlines purchases" },
  { tag: "hotel", label: "Hotels" },
  { tag: "streaming", label: "Streaming" },
  { tag: "drugstore", label: "Drugstores" },
  { tag: "home_improvement", label: "Home improvement" },
];

export const REWARD_CATEGORY_TAGS = REWARD_CATEGORIES.map((c) => c.tag) as RewardTag[];

export function rewardCategoryLabel(tag: string): string {
  return REWARD_CATEGORIES.find((c) => c.tag === tag)?.label ?? tag;
}
