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

/**
 * user_category value on an INCOMING payment meaning "this is someone paying me
 * back for a bill I fronted". The charge itself carries the offset in
 * `reimbursed_cents`; tagging the inflow keeps it out of the peer-to-peer net
 * (which would otherwise subtract it a second time).
 */
export const REIMBURSEMENT_CATEGORY = "REIMBURSEMENT";

/** Money-movement categories that are never consumption on their own. */
export const NON_SPEND_PRIMARY = ["TRANSFER_IN", "TRANSFER_OUT"];
/** Detailed codes dropped even inside a spend primary (card payments). */
export const NON_SPEND_DETAILED = ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];

/**
 * Merchants that are the user's OWN other bank, so money sent there is an
 * internal transfer, not spending — Plaid can't know this and files them under
 * LOAN_PAYMENTS_OTHER_PAYMENT, which would otherwise count as consumption.
 * Matched case-insensitively against merchant name and raw name. Keep entries
 * specific: the matching SoFi leg of these transfers already arrives as
 * TRANSFER_IN, and a bare "SOFI" would also swallow SoFi Stadium.
 */
export const OWN_BANK_MERCHANTS = ["MEMBERS CHOICE CREDIT UNION"];

// The sentinel embedded as a SQL literal (not a bound parameter). This matters
// for `effectiveCategory`: it appears in both SELECT and GROUP BY, and Postgres
// only matches them when the expression text is identical — two bound params at
// different positions would not match ("must appear in the GROUP BY clause").
// IGNORE_CATEGORY is a compile-time constant, so there's no injection risk.
const IGNORE_LITERAL = sql.raw(`'${IGNORE_CATEGORY}'`);
const REIMBURSEMENT_LITERAL = sql.raw(`'${REIMBURSEMENT_CATEGORY}'`);

/** True when the user has tagged a P2P payment with a real budget category. */
export const isCategorizedP2P: SQL = sql`(${transactions.userCategory} is not null and ${transactions.userCategory} not in (${IGNORE_LITERAL}, ${REIMBURSEMENT_LITERAL}))`;

/** An incoming payment the user tagged as paying them back (see REIMBURSEMENT_CATEGORY). */
export const isReimbursement: SQL = sql`coalesce(${transactions.userCategory}, '') = ${REIMBURSEMENT_LITERAL}`;

/**
 * The user's own share of a row: the charge minus what others paid back. This
 * is what budgets count; rewards still use the full amount_cents (the card
 * earned on the whole bill).
 */
export const netAmountCents: SQL<number> = sql<number>`(${transactions.amountCents} - coalesce(${transactions.reimbursedCents}, 0))`;

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
  // An explicit IGNORE always wins, on any row — not just P2P. It means the user
  // looked at this charge and said it isn't consumption (e.g. moving money to
  // their own other bank), and that judgment outranks Plaid's category.
  return sql`(not ${isIgnored} and ((${normalSpend}) or ${isCategorizedP2P}) and not ${isOwnBankTransfer})`;
}

/**
 * The user marked this row "not spending" (see IGNORE_CATEGORY). Coalesced
 * because this is negated in `spendRowPredicate`: on an un-reviewed row a bare
 * `user_category = 'IGNORE'` is NULL, and `not NULL` is NULL, which would drop
 * every ordinary purchase from spending.
 */
export const isIgnored: SQL = sql`coalesce(${transactions.userCategory}, '') = ${IGNORE_LITERAL}`;

/**
 * Money moved to the user's own other bank (see OWN_BANK_MERCHANTS). Excluded
 * from spending, and added to the "internal transfers" bucket of the
 * reconciliation footer so the money is still accounted for.
 */
export const isOwnBankTransfer: SQL = sql`(${sql.join(
  OWN_BANK_MERCHANTS.map(
    (m) =>
      sql`upper(coalesce(${transactions.merchantName}, '') || ' ' || ${transactions.name}) like ${`%${m}%`}`,
  ),
  sql` or `,
)})`;

// ---------------------------------------------------------------------------
// Amortized charges (a lump premium spread across the months it covers)
// ---------------------------------------------------------------------------

/** Calendar-month index (year*12 + month) of a JS date — matches monthIndexSql. */
function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * The date a row budgets under: the user's `budget_month` override when set,
 * otherwise when it posted. Every spending window is measured against this, so
 * a charge paid ahead of the period it covers lands in the right month. Note
 * that posted_at is rewritten from Plaid on every sync, so moving a charge
 * between months has to be an override — editing posted_at does not survive.
 */
export const budgetAt: SQL = sql`coalesce(${transactions.budgetMonth}::timestamptz, ${transactions.postedAt})`;

/** Calendar-month index of the budget date, for slicing amortized charges. */
const postedMonthIndex: SQL<number> = sql`(extract(year from ${budgetAt})::int * 12 + extract(month from ${budgetAt})::int - 1)`;

export interface Window {
  from?: Date;
  to?: Date;
}

/**
 * Slice bounds for an amortized charge within a window: `k` is the 0-based
 * month offset from the charge's own month, clamped to the window and to the
 * charge's own length. kEnd < kStart means the charge doesn't touch the window.
 */
function sliceBounds(w: Window): { kStart: SQL; kEnd: SQL } {
  const months = transactions.amortizeMonths;
  const kStart = w.from
    ? sql`greatest(0, ${monthIndex(w.from)} - ${postedMonthIndex})`
    : sql`0`;
  const kEnd = w.to
    ? sql`least(${months} - 1, ${monthIndex(w.to)} - ${postedMonthIndex})`
    : sql`${months} - 1`;
  return { kStart, kEnd };
}

/**
 * The amount of a row attributable to `w`, net of any reimbursement (see
 * netAmountCents). Normal rows contribute in full (the
 * caller's date filter already decided they're in range); amortized rows
 * contribute only the slices covering the window. Exact by construction:
 * floor(amt*(kEnd+1)/N) - floor(amt*kStart/N) always re-sums to the charge.
 */
export function windowAmountCents(w: Window = {}): SQL<number> {
  const { kStart, kEnd } = sliceBounds(w);
  const months = transactions.amortizeMonths;
  const amt = netAmountCents;
  return sql<number>`(case
    when ${months} is null or ${months} <= 1 then ${amt}
    when ${kEnd} < ${kStart} then 0
    else (floor(${amt}::numeric * (${kEnd} + 1) / ${months}) - floor(${amt}::numeric * ${kStart} / ${months}))::int
  end)`;
}

/**
 * The budget date inside the window. Bounds are bound as ISO strings and cast
 * in SQL: postgres.js has no mapping for a bare JS Date in a raw template.
 */
export function postedInWindow(w: Window = {}): SQL {
  const clauses: SQL[] = [];
  if (w.from) clauses.push(sql`${budgetAt} >= ${w.from.toISOString()}::timestamptz`);
  if (w.to) clauses.push(sql`${budgetAt} <= ${w.to.toISOString()}::timestamptz`);
  return clauses.length > 0 ? sql.join(clauses, sql` and `) : sql`true`;
}

/**
 * When the money actually left the account, regardless of which month it's
 * budgeted to. Only the reconciliation footer wants this — it's what balances
 * "cash out this month" against "budgeted this month".
 */
export function cashPaidInWindow(w: Window = {}): SQL {
  const clauses: SQL[] = [];
  if (w.from) clauses.push(sql`${transactions.postedAt} >= ${w.from.toISOString()}::timestamptz`);
  if (w.to) clauses.push(sql`${transactions.postedAt} <= ${w.to.toISOString()}::timestamptz`);
  return clauses.length > 0 ? sql`(${sql.join(clauses, sql` and `)})` : sql`true`;
}

/**
 * Time filter for spending queries. Normal rows must have posted inside the
 * window; an amortized row qualifies whenever any of its monthly slices lands
 * in the window, even if the charge itself posted months earlier.
 */
export function inWindow(w: Window = {}): SQL {
  const { kStart, kEnd } = sliceBounds(w);
  const posted = postedInWindow(w);
  return sql`(case
    when ${transactions.amortizeMonths} is null or ${transactions.amortizeMonths} <= 1 then (${posted})
    else ${kEnd} >= ${kStart}
  end)`;
}
