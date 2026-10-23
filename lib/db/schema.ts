import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  numeric,
  date,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for the personal finance aggregator.
 *
 * Conventions:
 *  - Money is stored as integer cents (never floats). See lib/money.
 *  - Amount sign convention: positive = money leaving the account (outflow).
 *    Normalize at write-time so the dashboard never special-cases institutions.
 *  - Plaid-native IDs (account_id, transaction_id) are used as primary keys
 *    where Plaid provides a stable identifier, which keeps sync upserts simple.
 */

export const itemStatusEnum = pgEnum("item_status", ["good", "login_required", "error"]);

/** One row per Plaid connection (per institution). */
export const items = pgTable("items", {
  id: text("id").primaryKey(), // app-generated (Plaid item_id stored separately if needed)
  plaidItemId: text("plaid_item_id").notNull().unique(),
  institutionName: text("institution_name").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  cursor: text("cursor"),
  status: itemStatusEnum("status").notNull().default("good"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Accounts within an item (a card, a checking account, a brokerage). */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(), // Plaid account_id
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  officialName: text("official_name"),
  type: text("type").notNull(),
  subtype: text("subtype"),
  mask: text("mask"),
  currentBalanceCents: integer("current_balance_cents"),
  availableBalanceCents: integer("available_balance_cents"),
  isoCurrency: text("iso_currency").default("USD"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(), // positive = outflow
    merchantName: text("merchant_name"),
    name: text("name").notNull(),
    pfcPrimary: text("pfc_primary"),
    pfcDetailed: text("pfc_detailed"),
    mcc: text("mcc"),
    pending: boolean("pending").notNull().default(false),
    pendingTransactionId: text("pending_transaction_id"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // Computed by the rewards pass (lib/rewards/compute.ts) on every sync.
    optimalCardId: text("optimal_card_id"),
    rewardDeltaCents: integer("reward_delta_cents"),
    // User override of the budget category (set in the transaction editor, the
    // P2P review queue, or by a category rule). A BUDGETABLE_CATEGORIES code
    // counts the row as spend in that category — this is how Venmo/Zelle/CashApp
    // payments, which Plaid files as TRANSFER_OUT_FROM_APPS, become real spend.
    // The sentinel "IGNORE" drops it from spending, "REIMBURSEMENT" marks an
    // incoming payback, null = Plaid's category. `userMemo` is a free-text note.
    userCategory: text("user_category"),
    userMemo: text("user_memo"),
    // Spread this charge evenly across N budget months starting with the month
    // it posted (null = counts entirely in its own month). For premiums paid in
    // one lump — e.g. 6-month auto insurance — so a month isn't blown out by a
    // bill that really covers half a year. Slices are exact: each month gets
    // floor(amt*(k+1)/N) - floor(amt*k/N), so they always re-sum to the charge.
    amortizeMonths: integer("amortize_months"),
    // Budget the charge into this calendar month instead of the one it posted
    // in (null = use posted_at). For charges paid ahead of the period they
    // cover — rent paid on the 30th for the next month. A user override, so
    // unlike posted_at (which sync rewrites from Plaid every run) it sticks.
    budgetMonth: date("budget_month"),
    // How much of this charge other people paid back (null = none). For a bill
    // the user fronted for a group — friends Venmo/Zelle their share — so the
    // budget counts only the user's own share (amount_cents - reimbursed_cents).
    // The incoming payments are tagged user_category = "REIMBURSEMENT" so the
    // peer-to-peer net card doesn't subtract them a second time. A user
    // override like the columns above: sync never writes it.
    reimbursedCents: integer("reimbursed_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_account_idx").on(t.accountId),
    index("transactions_posted_idx").on(t.postedAt),
    index("transactions_pfc_primary_idx").on(t.pfcPrimary),
    // Lookup used by the pending->posted replacement rule.
    index("transactions_pending_txn_idx").on(t.pendingTransactionId),
  ],
);

/** Investment positions. quantity kept as numeric (fractional shares). */
export const holdings = pgTable(
  "holdings",
  {
    id: text("id").primaryKey(), // accountId + securityId composite, app-generated
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id").notNull(),
    ticker: text("ticker"),
    name: text("name").notNull(),
    quantity: numeric("quantity").notNull(),
    valueCents: integer("value_cents").notNull(),
    costBasisCents: integer("cost_basis_cents"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("holdings_account_idx").on(t.accountId)],
);

/**
 * Investment transactions (buys/sells/dividends/fees) for brokerage accounts.
 * Unlike holdings, Plaid gives these a stable investment_transaction_id, so we
 * upsert on it. Amount sign matches our convention: positive = cash leaving the
 * account (a buy), negative = cash in (a sell/dividend). Kept separate from the
 * `transactions` table so they never leak into spending/budget analytics.
 */
export const investmentTransactions = pgTable(
  "investment_transactions",
  {
    id: text("id").primaryKey(), // Plaid investment_transaction_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id"), // null for cash-only moves (deposits, fees)
    ticker: text("ticker"),
    securityName: text("security_name"),
    name: text("name").notNull(),
    type: text("type").notNull(), // buy | sell | cash | fee | transfer | cancel
    subtype: text("subtype"),
    quantity: numeric("quantity").notNull(),
    priceCents: integer("price_cents"), // per-unit price
    amountCents: integer("amount_cents").notNull(), // positive = cash out (buy)
    feesCents: integer("fees_cents"),
    isoCurrency: text("iso_currency").default("USD"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("investment_txns_account_idx").on(t.accountId),
    index("investment_txns_posted_idx").on(t.postedAt),
  ],
);

/**
 * Daily net-worth history. Plaid only ever exposes *current* balances, so the
 * only way to chart net worth over time is to record it ourselves: every sync
 * upserts one row for today (keyed on `day`), so re-syncing the same day
 * overwrites rather than duplicating, and the series is one point per day.
 */
export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  day: date("day").primaryKey(), // UTC calendar day, "YYYY-MM-DD"
  assetsCents: integer("assets_cents").notNull(),
  liabilitiesCents: integer("liabilities_cents").notNull(), // positive = owed
  netWorthCents: integer("net_worth_cents").notNull(), // assets − liabilities
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The user's credit cards and their reward rules (see lib/rewards/rules.ts).
 * Sync creates a default 1% card for each new credit account; the user edits
 * the real rates on the Cards page. Fee, sign-up bonus and notes are display-only.
 */
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  earnRules: jsonb("earn_rules").notNull(),
  annualFeeCents: integer("annual_fee_cents"),
  signupBonus: text("signup_bonus"),
  notes: text("notes"),
});

export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  category: text("category").notNull(), // matches transactions.pfcPrimary
  monthlyLimitCents: integer("monthly_limit_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * "Merchant contains X → category" rules. Applied when written (to every
 * matching transaction without an override yet) and by sync to new rows, by
 * setting `transactions.user_category` — so the spend SQL never has to know
 * about rules. `category` is a budget category or the IGNORE sentinel.
 */
export const categoryRules = pgTable("category_rules", {
  id: text("id").primaryKey(),
  match: text("match").notNull(), // case-insensitive substring of merchant name or description
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type NewInvestmentTransaction = typeof investmentTransactions.$inferInsert;
export type NetWorthSnapshot = typeof netWorthSnapshots.$inferSelect;
export type NewNetWorthSnapshot = typeof netWorthSnapshots.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type CategoryRule = typeof categoryRules.$inferSelect;
