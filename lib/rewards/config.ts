/**
 * Tunable rewards configuration — the ONE place to edit quarter categories and
 * miles valuation (§7). Issuers change these; confirm before relying on them.
 */

/** Abstract reward category tags used by card rules and transaction tagging. */
export type RewardTag =
  | "dining"
  | "grocery"
  | "wholesale_club"
  | "streaming"
  | "gas"
  | "ev_charging"
  | "transit"
  | "flights"
  | "drugstore"
  | "home_improvement"
  | "hotel"
  | "united";

/**
 * Discover "it" rotating 5% categories by quarter (announced one quarter at a
 * time). Key is `YYYY-Qn`. 2026 Q4 is not yet announced — leave empty/editable.
 */
export const DISCOVER_QUARTERS: Record<string, RewardTag[]> = {
  "2026-Q1": ["grocery", "wholesale_club", "streaming"],
  "2026-Q2": ["dining", "home_improvement"],
  "2026-Q3": ["gas", "ev_charging", "transit", "flights", "drugstore"],
  "2026-Q4": [], // not announced yet
};

/** Value of one United mile, in cents (tunable). */
export const MILES_VALUE_CENTS = 1.3;

/** Discover 5% rotating cap: $1,500 of bonus spend per quarter. */
export const DISCOVER_CAP_CENTS = 150_000;

/** Map a date to its `YYYY-Qn` key for Discover quarter lookups. */
export function quarterKey(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${q}`;
}

/** Active Discover rotating categories for the quarter containing `date`. */
export function discoverCategoriesFor(date: Date): RewardTag[] {
  return DISCOVER_QUARTERS[quarterKey(date)] ?? [];
}
