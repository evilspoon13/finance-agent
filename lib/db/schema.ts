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
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

/**
 * Free-form context for the scheduled finance agent, keyed by name:
 *  - "goals": the user's profile, goals and rules (user-edited, in Settings);
 *  - "notes": the agent's own running memory across runs (facts the user told
 *    it in a reply, decisions, things already explained). The agent rewrites it;
 *    the user can edit it in Settings too;
 *  - "profile": structured numbers and rules as JSON (lib/agent/profile.ts).
 * Kept in the DB so personal details never live in the repo.
 */
export const agentContext = pgTable("agent_context", {
  key: text("key").primaryKey(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What the agent reported on each run. Its own history (so it doesn't repeat a
 * flag) and the /briefings page. `notified` = flagged as needing the user.
 */
export const agentBriefings = pgTable(
  "agent_briefings",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // daily | weekly | monthly | adhoc
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown
    notified: boolean("notified").notNull().default(false),
    sessionUrl: text("session_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_briefings_created_idx").on(t.createdAt)],
);

export const agentActionStatusEnum = pgEnum("agent_action_status", ["open", "done", "dismissed"]);

/**
 * Follow-ups the agent asked the user to do ("move $5k of idle cash to the
 * brokerage by Nov 30"). Every run sees the open ones and checks on them; the
 * user closes them on /briefings, or the agent does once it sees it happened.
 */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    detail: text("detail"),
    dueOn: date("due_on"),
    status: agentActionStatusEnum("status").notNull().default("open"),
    note: text("note"), // how it was resolved, or why it was dismissed
    // "action" = something to do; "question" = something the agent needs to know.
    // The user answers a question on /briefings; `answer` is their exact words.
    kind: text("kind").notNull().default("action"),
    answer: text("answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("agent_actions_status_idx").on(t.status)],
);

/**
 * The agent's long-term knowledge: one fact per row, with where it came from.
 * `source`: "user" = the user wrote or confirmed it in the app; "observed" = seen
 * in the data; "reported" = the agent's paraphrase of a chat reply; "inferred" =
 * the agent's guess. Reported and inferred rows wait in "pending_review" until the
 * user confirms them, so a misreading can't become fact (see lib/agent/knowledge.ts).
 * Rows are superseded rather than overwritten, so a slug keeps its history.
 */
export const agentKnowledge = pgTable(
  "agent_knowledge",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    topic: text("topic").notNull(),
    body: text("body").notNull(),
    source: text("source").notNull(), // user | observed | reported | inferred
    status: text("status").notNull(), // active | pending_review | superseded | rejected
    sessionUrl: text("session_url"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresOn: date("expires_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_knowledge_slug_idx").on(t.slug),
    index("agent_knowledge_status_idx").on(t.status),
    uniqueIndex("agent_knowledge_active_slug_idx").on(t.slug).where(sql`${t.status} = 'active'`),
  ],
);

/** Numbers a run wants the next one to compare against, one row per kind and period. */
export const agentScorecards = pgTable(
  "agent_scorecards",
  {
    kind: text("kind").notNull(), // weekly | monthly
    period: text("period").notNull(), // e.g. 2026-11-08, 2026-10
    metrics: jsonb("metrics").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.period] })],
);

/**
 * Market research written by the web-facing runs (docs/research.md). Those runs
 * never see financial data, and everything here is web-derived: readers must
 * treat it as untrusted text, not instructions.
 */
export const researchMemos = pgTable(
  "research_memos",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // pulse | weekly | deep_dive
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown
    sources: jsonb("sources").notNull().default([]), // [{title, url, date}]
    sessionUrl: text("session_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_memos_created_idx").on(t.createdAt)],
);

/** The watchlist and thesis ledger: one row per ticker, kept across research runs. */
export const investmentIdeas = pgTable("investment_ideas", {
  ticker: text("ticker").primaryKey(),
  name: text("name"),
  status: text("status").notNull().default("researching"), // researching | watch | proposed | owned | rejected
  thesis: text("thesis"),
  bearCase: text("bear_case"),
  valuation: text("valuation"),
  invalidation: text("invalidation"), // what would prove the thesis wrong
  nextReviewOn: date("next_review_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A concrete investing proposal, kept whether or not the user acts on it: entry
 * prices are recorded so every proposal can be scored against the benchmark.
 */
export const investmentProposals = pgTable(
  "investment_proposals",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    action: text("action").notNull(), // buy | sell | hold
    account: text("account").notNull(),
    amountCents: integer("amount_cents").notNull(),
    rationale: text("rationale").notNull(),
    entryCondition: text("entry_condition"),
    invalidation: text("invalidation"),
    reviewOn: date("review_on"),
    entryPriceCents: integer("entry_price_cents"),
    benchmarkTicker: text("benchmark_ticker").notNull(),
    benchmarkPriceCents: integer("benchmark_price_cents"),
    status: text("status").notNull().default("proposed"), // proposed | accepted | declined
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("investment_proposals_created_idx").on(t.createdAt)],
);

/** One closing price per ticker per day, for held and watched tickers and the benchmark. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    ticker: text("ticker").notNull(),
    day: date("day").notNull(),
    closeCents: integer("close_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.day] })],
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
export type CategoryRule = typeof categoryRules.$inferSelect;
export type AgentBriefing = typeof agentBriefings.$inferSelect;
export type AgentAction = typeof agentActions.$inferSelect;
export type AgentKnowledge = typeof agentKnowledge.$inferSelect;
export type ResearchMemo = typeof researchMemos.$inferSelect;
export type InvestmentIdea = typeof investmentIdeas.$inferSelect;
export type InvestmentProposal = typeof investmentProposals.$inferSelect;
