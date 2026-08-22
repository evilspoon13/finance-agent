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
 * Drizzle schema for the personal finance aggregator (§4 of the build spec).
 *
 * Conventions:
 *  - Money is stored as integer cents (never floats). See lib/money.
 *  - Amount sign convention: positive = money leaving the account (outflow).
 *    Normalize at write-time so the dashboard never special-cases institutions.
 *  - Plaid-native IDs (account_id, transaction_id) are used as primary keys
 *    where Plaid provides a stable identifier, which keeps sync upserts simple.
 */

export const itemStatusEnum = pgEnum("item_status", ["good", "login_required", "error"]);
export const alertKindEnum = pgEnum("alert_kind", ["budget", "wrong_card", "anomaly"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

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
    // Phase 4 computed columns (seams for the deferred alerter).
    optimalCardId: text("optimal_card_id"),
    rewardDeltaCents: integer("reward_delta_cents"),
    // User-assigned budget category for peer-to-peer app payments (Venmo/Zelle/
    // CashApp). Plaid buckets these under TRANSFER_OUT_FROM_APPS with no idea what
    // they were for, so the user tags each one: a BUDGETABLE_CATEGORIES code makes
    // it count as real spend, the sentinel "IGNORE" dismisses it, null = not yet
    // reviewed. `userMemo` is the free-text note ("rent", "car payment").
    userCategory: text("user_category"),
    userMemo: text("user_memo"),
    // Spread this charge evenly across N budget months starting with the month
    // it posted (null = counts entirely in its own month). For premiums paid in
    // one lump — 6-month auto/renters insurance — so a month isn't blown out by
    // a bill that really covers half a year. Slices are exact: each month gets
    // floor(amt*(k+1)/N) - floor(amt*k/N), so they always re-sum to the charge.
    amortizeMonths: integer("amortize_months"),
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

/** Investment positions (Schwab). quantity kept as numeric (fractional shares). */
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

/** Card config for the rewards engine (seeded; see §7). */
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  network: text("network").notNull(),
  earnRules: jsonb("earn_rules").notNull(),
  discoverCapCents: integer("discover_cap_cents"),
  cashbackMatchYearOne: boolean("cashback_match_year_one").notNull().default(false),
  // AI-driven rewards: the user must confirm what the AI found before a card
  // counts toward recommendations. `aiSuggestion` caches the raw lookup for the
  // confirm UI; fee/signup/notes are display-only info.
  rewardsConfirmed: boolean("rewards_confirmed").notNull().default(false),
  annualFeeCents: integer("annual_fee_cents"),
  signupBonus: text("signup_bonus"),
  aiNotes: text("ai_notes"),
  aiSuggestion: jsonb("ai_suggestion"),
});

export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  category: text("category").notNull(), // matches transactions.pfcPrimary
  monthlyLimitCents: integer("monthly_limit_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Schema only for now; nothing writes here until Phase 5. */
export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  kind: alertKindEnum("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

/**
 * Cache for generated AI insights. `fingerprint` captures the underlying
 * spending (count + sum + latest updated_at) so a cached insight is reused
 * until the spending in that scope actually changes.
 */
export const aiCache = pgTable("ai_cache", {
  scope: text("scope").primaryKey(), // e.g. insight:<from>:<to>:<account>
  fingerprint: text("fingerprint").notNull(),
  model: text("model").notNull(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI chat persistence. One row per conversation; messages hold only the visible
 * user/assistant turns (tool calls stay ephemeral) — that's all the agent needs
 * to reconstruct history and keeps the per-request token footprint small.
 */
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(), // app-generated uuid
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(), // app-generated uuid
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

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
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
