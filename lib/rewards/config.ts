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

/** Map a date to its `YYYY-Qn` key, the key of a rotating card's schedule. */
export function quarterKey(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${q}`;
}
