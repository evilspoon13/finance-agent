/** Humanize a Plaid personal_finance_category primary code, e.g.
 *  "FOOD_AND_DRINK" -> "Food and drink". */
export function humanizeCategory(code: string | null | undefined): string {
  if (!code) return "Uncategorized";
  return code
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w === "and" ? "and" : w))
    .join(" ");
}
