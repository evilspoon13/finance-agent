import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  numeric,
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

/** Card config for the rewards engine (seeded; see §7). */
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  network: text("network").notNull(),
  earnRules: jsonb("earn_rules").notNull(),
  discoverCapCents: integer("discover_cap_cents"),
  cashbackMatchYearOne: boolean("cashback_match_year_one").notNull().default(false),
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

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
