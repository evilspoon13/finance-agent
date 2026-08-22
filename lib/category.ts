/** All Plaid personal_finance_category primary codes. */
export const PFC_PRIMARIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
] as const;

/**
 * A budget category that is NOT a Plaid primary. Plaid files insurance under
 * GENERAL_SERVICES (auto) and RENT_AND_UTILITIES (renters), which buries a
 * predictable fixed cost inside two noisy lines. Assigned via
 * `transactions.user_category`, like the peer-to-peer overrides.
 */
export const INSURANCE_CATEGORY = "INSURANCE";

/** Plaid PFC primary categories suitable for budgeting (consumption only —
 *  excludes income, transfers, and loan payments), plus INSURANCE. */
export const BUDGETABLE_CATEGORIES = [
  INSURANCE_CATEGORY,
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "TRANSPORTATION",
  "TRAVEL",
  "ENTERTAINMENT",
  "GENERAL_SERVICES",
  "PERSONAL_CARE",
  "MEDICAL",
  "HOME_IMPROVEMENT",
  "RENT_AND_UTILITIES",
  "GOVERNMENT_AND_NON_PROFIT",
] as const;

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
