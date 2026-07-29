import { sql, type SQL } from "drizzle-orm";
import { transactions } from "./schema";

/**
 * Shared SQL fragments for "what counts as spending" so the budgets page, the
 * dashboard, and the AI agent all agree — including the peer-to-peer override.
 *
 * Plaid buckets Venmo/Zelle/CashApp payments under TRANSFER_OUT_FROM_APPS and
 * excludes them from spending (they look like transfers). The user categorizes
 * each app payment into a real budget category via the review screen; once
 * tagged, it counts as spend under `user_category`. The sentinel below dismisses
 * a payment ("not real spending") without leaving it on the review list.
 */

export const P2P_OUT_DETAILED = "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS";
export const P2P_IN_DETAILED = "TRANSFER_IN_TRANSFER_IN_FROM_APPS";

/** user_category value meaning "reviewed, but not spending — leave it out". */
export const IGNORE_CATEGORY = "IGNORE";

/** Money-movement categories that are never consumption on their own. */
export const NON_SPEND_PRIMARY = ["TRANSFER_IN", "TRANSFER_OUT"];
/** Detailed codes dropped even inside a spend primary (card payments). */
export const NON_SPEND_DETAILED = ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];

// The sentinel embedded as a SQL literal (not a bound parameter). This matters
// for `effectiveCategory`: it appears in both SELECT and GROUP BY, and Postgres
// only matches them when the expression text is identical — two bound params at
// different positions would not match ("must appear in the GROUP BY clause").
// IGNORE_CATEGORY is a compile-time constant, so there's no injection risk.
const IGNORE_LITERAL = sql.raw(`'${IGNORE_CATEGORY}'`);

/** True when the user has tagged a P2P payment with a real budget category. */
export const isCategorizedP2P: SQL = sql`(${transactions.userCategory} is not null and ${transactions.userCategory} <> ${IGNORE_LITERAL})`;

/**
 * The category a transaction counts under: a user-assigned P2P category wins,
 * otherwise Plaid's primary. `IGNORE` never surfaces (those rows aren't spend).
 */
export const effectiveCategory: SQL<string> = sql`coalesce(nullif(${transactions.userCategory}, ${IGNORE_LITERAL}), ${transactions.pfcPrimary})`;

/**
 * Whether a row is consumption to count in spending views: a normal purchase
 * (not a transfer, not a card payment), OR a user-categorized P2P payment.
 * Amount-sign / pending / time / account scoping is applied by the caller.
 */
export function spendRowPredicate(): SQL {
  const transferExcl = NON_SPEND_PRIMARY.map(
    (p) => sql`coalesce(${transactions.pfcPrimary}, '') <> ${p}`,
  );
  const detailedExcl = NON_SPEND_DETAILED.map(
    (d) => sql`coalesce(${transactions.pfcDetailed}, '') <> ${d}`,
  );
  const normalSpend = sql.join([...transferExcl, ...detailedExcl], sql` and `);
  return sql`((${normalSpend}) or ${isCategorizedP2P})`;
}
