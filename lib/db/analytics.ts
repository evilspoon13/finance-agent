import { and, gte, lte, eq, inArray, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db } from "./client";
import {
  accounts,
  transactions,
  holdings,
  investmentTransactions,
  items,
  cards,
  type Account,
} from "./schema";
import {
  P2P_OUT_DETAILED,
  P2P_IN_DETAILED,
  effectiveCategory,
  spendRowPredicate,
  windowAmountCents,
  inWindow,
  isOwnBankTransfer,
  isIgnored,
  cashPaidInWindow,
  budgetAt,
} from "./spend-sql";

/** pfc_detailed filter accepting one subcategory or a set (e.g. all dining types). */
function detailedClause(detailed?: string | string[]): SQL | undefined {
  if (!detailed) return undefined;
  const list = Array.isArray(detailed) ? detailed : [detailed];
  if (list.length === 0) return undefined;
  return inArray(transactions.pfcDetailed, list);
}

/** Friendly display name for an account: the seeded card label if linked, else
 *  the (sometimes generic) Plaid account name. */
const displayName = sql<string>`coalesce(${cards.label}, ${accounts.name})`;

/**
 * Read-only analytics for the dashboard: net worth, spending breakdowns, and a
 * filterable transaction list. All money is integer cents.
 *
 * Account classification (Plaid `type`):
 *   depository -> cash asset
 *   investment -> investment asset (valued by holdings, falling back to balance)
 *   credit/loan -> liability
 */

export type AccountClass = "cash" | "investment" | "liability" | "other";

export function classify(type: string): AccountClass {
  switch (type) {
    case "depository":
      return "cash";
    case "investment":
    case "brokerage":
      return "investment";
    case "credit":
    case "loan":
      return "liability";
    default:
      return "other";
  }
}

export interface NetWorthLine {
  accountId: string;
  name: string;
  klass: AccountClass;
  valueCents: number; // signed contribution to net worth (assets +, liabilities -)
}

export interface NetWorth {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  lines: NetWorthLine[];
}

export async function getNetWorth(): Promise<NetWorth> {
  const accts = await db.select().from(accounts);

  // Friendly labels for accounts linked to a rewards card.
  const cardRows = await db.select({ accountId: cards.accountId, label: cards.label }).from(cards);
  const labelByAccount = new Map<string, string>();
  for (const r of cardRows) if (r.accountId) labelByAccount.set(r.accountId, r.label);

  // Sum holdings market value per investment account.
  const holdingsByAccount = new Map<string, number>();
  const hRows = await db
    .select({ accountId: holdings.accountId, total: sql<number>`sum(${holdings.valueCents})::int` })
    .from(holdings)
    .groupBy(holdings.accountId);
  for (const r of hRows) holdingsByAccount.set(r.accountId, r.total ?? 0);

  let assets = 0;
  let liabilities = 0;
  const lines: NetWorthLine[] = [];

  for (const a of accts) {
    const klass = classify(a.type);
    const balance = a.currentBalanceCents ?? 0;
    let value = 0;

    if (klass === "cash") {
      value = balance;
      assets += balance;
    } else if (klass === "investment") {
      // Prefer holdings value; fall back to the account balance if none synced.
      value = holdingsByAccount.get(a.id) ?? balance;
      assets += value;
    } else if (klass === "liability") {
      value = -balance; // owed amount reduces net worth
      liabilities += balance;
    } else {
      continue; // ignore unclassified accounts
    }
    lines.push({ accountId: a.id, name: labelByAccount.get(a.id) ?? a.name, klass, valueCents: value });
  }

  lines.sort((x, y) => y.valueCents - x.valueCents);
  return {
    assetsCents: assets,
    liabilitiesCents: liabilities,
    netWorthCents: assets - liabilities,
    lines,
  };
}

/** A single investment position with per-holding gain/loss and allocation. */
export interface PortfolioHolding {
  ticker: string | null;
  name: string;
  account: string;
  quantity: string;
  valueCents: number;
  costBasisCents: number | null;
  gainCents: number | null; // value − cost (null when no cost basis, e.g. cash)
  gainPct: number | null;
  pctOfPortfolio: number; // share of market value (within its account, see getInvestments)
}

// ---------------------------------------------------------------------------
// Investments (detailed, per-account: taxable brokerage / 401k / Roth)
// ---------------------------------------------------------------------------

export type InvestmentKind = "taxable" | "401k" | "roth" | "ira" | "hsa" | "other";

export interface InvestmentActivity {
  id: string;
  postedAt: Date | null;
  type: string; // buy | sell | cash | fee | transfer | cancel
  subtype: string | null;
  ticker: string | null;
  securityName: string | null;
  name: string;
  quantity: string;
  amountCents: number; // positive = cash out (buy), negative = cash in
  priceCents: number | null;
  feesCents: number | null;
}

export interface InvestmentAccount {
  accountId: string;
  name: string;
  institution: string | null;
  subtype: string | null;
  kind: InvestmentKind;
  valueCents: number;
  costCents: number; // summed over holdings with a cost basis
  gainCents: number;
  gainPct: number | null;
  holdings: PortfolioHolding[]; // pctOfPortfolio = share within THIS account
  activity: InvestmentActivity[];
}

export interface Investments {
  totalValueCents: number;
  totalCostCents: number;
  totalGainCents: number;
  totalGainPct: number | null;
  accounts: InvestmentAccount[];
}

/** Map a Plaid investment-account subtype to a coarse kind for grouping/labels. */
export function investmentKind(subtype: string | null): InvestmentKind {
  switch ((subtype ?? "").toLowerCase()) {
    case "brokerage":
    case "non-taxable brokerage account":
    case "cash management":
      return "taxable";
    case "401k":
    case "401a":
    case "403b":
    case "457b":
      return "401k";
    case "roth":
    case "roth 401k":
      return "roth";
    case "ira":
    case "sep ira":
    case "simple ira":
    case "rollover":
      return "ira";
    case "hsa":
      return "hsa";
    default:
      return "other";
  }
}

/**
 * Detailed per-account investment view: each brokerage/retirement account with
 * its holdings (gain/loss + allocation within the account) and recent activity
 * (buys/sells/dividends/fees from investment_transactions), plus overall totals.
 * Value prefers summed holdings market value, falling back to account balance.
 */
export async function getInvestments(): Promise<Investments> {
  const acctRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      subtype: accounts.subtype,
      balanceCents: accounts.currentBalanceCents,
      institution: items.institutionName,
    })
    .from(accounts)
    .innerJoin(items, eq(items.id, accounts.itemId))
    .where(eq(accounts.type, "investment"));

  if (acctRows.length === 0) {
    return { totalValueCents: 0, totalCostCents: 0, totalGainCents: 0, totalGainPct: null, accounts: [] };
  }

  const acctIds = acctRows.map((a) => a.id);

  const hRows = await db
    .select({
      accountId: holdings.accountId,
      ticker: holdings.ticker,
      name: holdings.name,
      quantity: holdings.quantity,
      valueCents: holdings.valueCents,
      costBasisCents: holdings.costBasisCents,
    })
    .from(holdings)
    .where(inArray(holdings.accountId, acctIds))
    .orderBy(desc(holdings.valueCents));

  const aRows = await db
    .select()
    .from(investmentTransactions)
    .where(inArray(investmentTransactions.accountId, acctIds))
    .orderBy(desc(investmentTransactions.postedAt));

  const holdingsByAccount = new Map<string, typeof hRows>();
  for (const h of hRows) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }
  const activityByAccount = new Map<string, InvestmentActivity[]>();
  for (const t of aRows) {
    const list = activityByAccount.get(t.accountId) ?? [];
    list.push({
      id: t.id,
      postedAt: t.postedAt,
      type: t.type,
      subtype: t.subtype,
      ticker: t.ticker,
      securityName: t.securityName,
      name: t.name,
      quantity: t.quantity,
      amountCents: t.amountCents,
      priceCents: t.priceCents,
      feesCents: t.feesCents,
    });
    activityByAccount.set(t.accountId, list);
  }

  const outAccounts: InvestmentAccount[] = acctRows.map((a) => {
    const hs = holdingsByAccount.get(a.id) ?? [];
    const holdingsValue = hs.reduce((s, h) => s + h.valueCents, 0);
    // Prefer holdings market value; fall back to the account balance if none synced.
    const valueCents = hs.length > 0 ? holdingsValue : a.balanceCents ?? 0;

    let costWithBasis = 0;
    let valueWithBasis = 0;
    for (const h of hs) {
      if (h.costBasisCents != null) {
        costWithBasis += h.costBasisCents;
        valueWithBasis += h.valueCents;
      }
    }
    const gainCents = valueWithBasis - costWithBasis;

    const holdingList: PortfolioHolding[] = hs.map((h) => {
      const g = h.costBasisCents != null ? h.valueCents - h.costBasisCents : null;
      const gPct = h.costBasisCents && h.costBasisCents > 0 ? ((h.valueCents - h.costBasisCents) / h.costBasisCents) * 100 : null;
      return {
        ticker: h.ticker,
        name: h.name,
        account: a.name,
        quantity: h.quantity,
        valueCents: h.valueCents,
        costBasisCents: h.costBasisCents,
        gainCents: g,
        gainPct: gPct,
        pctOfPortfolio: holdingsValue > 0 ? (h.valueCents / holdingsValue) * 100 : 0,
      };
    });

    return {
      accountId: a.id,
      name: a.name,
      institution: a.institution,
      subtype: a.subtype,
      kind: investmentKind(a.subtype),
      valueCents,
      costCents: costWithBasis,
      gainCents,
      gainPct: costWithBasis > 0 ? (gainCents / costWithBasis) * 100 : null,
      holdings: holdingList,
      activity: activityByAccount.get(a.id) ?? [],
    };
  });

  outAccounts.sort((x, y) => y.valueCents - x.valueCents);

  const totalValue = outAccounts.reduce((s, a) => s + a.valueCents, 0);
  const totalCost = outAccounts.reduce((s, a) => s + a.costCents, 0);
  const totalGain = outAccounts.reduce((s, a) => s + a.gainCents, 0);

  return {
    totalValueCents: totalValue,
    totalCostCents: totalCost,
    totalGainCents: totalGain,
    totalGainPct: totalCost > 0 ? (totalGain / totalCost) * 100 : null,
    accounts: outAccounts,
  };
}

export interface Paycheck {
  postedAt: Date | null;
  employer: string;
  amountCents: number; // net deposit (positive)
}
export interface IncomeTypeTotal {
  type: string; // pfc_detailed, e.g. INCOME_SALARY
  cents: number;
}
export interface IncomeSummary {
  ytdCents: number; // all income this calendar year (net deposits)
  last12moCents: number;
  ytdByType: IncomeTypeTotal[];
  paychecks: Paycheck[]; // INCOME_SALARY deposits, most recent first
}

/**
 * Employer paychecks + income summary, derived from `INCOME` transactions. These
 * are NET deposits — Plaid transactions don't carry gross pay, taxes, or 401(k)
 * deductions. Income rows are stored as inflows (amount < 0); we flip the sign.
 *
 * Only depository (bank) accounts count: an "income" entry on a credit-card
 * account is a statement credit / DirectPay artifact, not money earned.
 */
export async function getIncomeSummary(now = new Date()): Promise<IncomeSummary> {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const twelveMoAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, now.getUTCDate()));
  const bankOnly = sql`${transactions.accountId} in (select ${accounts.id} from ${accounts} where ${accounts.type} = 'depository')`;
  const incomeBase = and(eq(transactions.pfcPrimary, "INCOME"), eq(transactions.pending, false), bankOnly);

  const ytdRows = await db
    .select({
      det: transactions.pfcDetailed,
      cents: sql<number>`-sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .where(and(incomeBase, gte(transactions.postedAt, yearStart)))
    .groupBy(transactions.pfcDetailed)
    .orderBy(sql`sum(${transactions.amountCents}) asc`);
  const ytdByType: IncomeTypeTotal[] = ytdRows.map((r) => ({ type: r.det ?? "INCOME", cents: r.cents ?? 0 }));
  const ytdCents = ytdByType.reduce((s, r) => s + r.cents, 0);

  const [l12] = await db
    .select({ cents: sql<number>`-coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(and(incomeBase, gte(transactions.postedAt, twelveMoAgo)));

  const payRows = await db
    .select({
      postedAt: transactions.postedAt,
      employer: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      cents: sql<number>`-${transactions.amountCents}`,
    })
    .from(transactions)
    .where(and(eq(transactions.pfcDetailed, "INCOME_SALARY"), eq(transactions.pending, false), bankOnly))
    .orderBy(sql`${transactions.postedAt} desc`)
    .limit(24);

  return {
    ytdCents,
    last12moCents: l12?.cents ?? 0,
    ytdByType,
    paychecks: payRows.map((r) => ({ postedAt: r.postedAt, employer: r.employer, amountCents: r.cents })),
  };
}

export interface SpendingFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
}

// What counts as spending — normal purchases plus user-categorized peer-to-peer
// payments — lives in spend-sql so the dashboard and AI agent agree. Transfers
// and credit-card payments stay out (they'd double-count or aren't consumption),
// except a P2P app payment the user has tagged with a real budget category.
function spendingWhere(f: SpendingFilter): SQL | undefined {
  const clauses: SQL[] = [
    // Outflows only (positive = money leaving the account).
    sql`${transactions.amountCents} > 0`,
    sql`${transactions.pending} = false`,
    spendRowPredicate(),
    // Date filter lives in inWindow() so amortized charges can reach into the
    // window from an earlier month (see spend-sql).
    inWindow(f),
  ];
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  return and(...clauses);
}

export interface SpendTotal {
  totalCents: number;
  count: number;
}

/**
 * Exact spend total + transaction count for a scope (optionally narrowed to a
 * primary category or a set of detailed codes). Uses the same outflow-only,
 * transfer-excluding rules as the dashboard so the AI's totals match the UI.
 */
export async function spendingTotal(
  f: SpendingFilter & { category?: string; detailed?: string | string[] } = {},
): Promise<SpendTotal> {
  const clauses: SQL[] = [];
  const base = spendingWhere(f);
  if (base) clauses.push(base);
  if (f.category) clauses.push(sql`${effectiveCategory} = ${f.category}`);
  const det = detailedClause(f.detailed);
  if (det) clauses.push(det);

  const [row] = await db
    .select({
      totalCents: sql<number>`coalesce(sum(${windowAmountCents(f)}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...clauses));
  return { totalCents: row?.totalCents ?? 0, count: row?.count ?? 0 };
}

export interface CategorySpend {
  category: string;
  totalCents: number;
  count: number;
}

export async function spendingByCategory(f: SpendingFilter = {}): Promise<CategorySpend[]> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
      totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(spendingWhere(f))
    .groupBy(sql`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`)
    .orderBy(sql`sum(${windowAmountCents(f)}) desc`);
  return rows.map((r) => ({ category: r.category, totalCents: r.totalCents ?? 0, count: r.count }));
}

export interface MonthSpend {
  month: string; // YYYY-MM
  totalCents: number;
}

export async function spendingByMonth(f: SpendingFilter = {}): Promise<MonthSpend[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${budgetAt}), 'YYYY-MM')`,
      totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
    })
    .from(transactions)
    .where(spendingWhere(f))
    .groupBy(sql`date_trunc('month', ${budgetAt})`)
    .orderBy(sql`date_trunc('month', ${budgetAt}) desc`);
  return rows
    .filter((r) => r.month !== null)
    .map((r) => ({ month: r.month, totalCents: r.totalCents ?? 0 }));
}

export interface AccountSpend {
  accountId: string;
  name: string;
  totalCents: number;
}

export async function spendingByAccount(f: SpendingFilter = {}): Promise<AccountSpend[]> {
  const rows = await db
    .select({
      accountId: transactions.accountId,
      name: displayName,
      totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(spendingWhere(f))
    .groupBy(transactions.accountId, accounts.name, cards.label)
    .orderBy(sql`sum(${windowAmountCents(f)}) desc`);
  return rows.map((r) => ({ accountId: r.accountId, name: r.name, totalCents: r.totalCents ?? 0 }));
}

export interface TxnFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
  category?: string;
  detailed?: string | string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TxnRow {
  id: string;
  postedAt: Date | null;
  name: string;
  merchantName: string | null;
  accountName: string;
  category: string | null;
  memo: string | null; // user note on a categorized P2P payment
  amountCents: number;
  pending: boolean;
}

export async function listTransactions(f: TxnFilter = {}): Promise<TxnRow[]> {
  const clauses: SQL[] = [];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  if (f.category) clauses.push(sql`${effectiveCategory} = ${f.category}`);
  const det = detailedClause(f.detailed);
  if (det) clauses.push(det);
  if (f.search) {
    const q = `%${f.search}%`;
    clauses.push(sql`(${ilike(transactions.name, q)} or ${ilike(transactions.merchantName, q)})`);
  }

  const rows = await db
    .select({
      id: transactions.id,
      postedAt: transactions.postedAt,
      name: transactions.name,
      merchantName: transactions.merchantName,
      accountName: displayName,
      category: effectiveCategory,
      memo: transactions.userMemo,
      amountCents: transactions.amountCents,
      pending: transactions.pending,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(transactions.postedAt))
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);
  return rows;
}

export interface DetailedSpend {
  detailed: string;
  totalCents: number;
  count: number;
}
export interface MerchantSpend {
  merchant: string;
  totalCents: number;
  count: number;
}
export interface CategoryDrilldown {
  category: string;
  totalCents: number;
  count: number;
  pct: number; // share of total spending in range
  detailed: DetailedSpend[];
  topMerchants: MerchantSpend[];
  prevCents: number | null; // previous equal-length window, or null if no range
  trendPct: number | null; // % change vs previous window
}
export interface SpendingDrilldown {
  totalCents: number;
  categories: CategoryDrilldown[];
}

/** Previous equal-length window immediately before the current one (for trends). */
function previousWindow(f: SpendingFilter): { from: Date; to: Date } | null {
  if (!f.from) return null; // all-time -> no comparison window
  const to = f.from;
  const end = f.to ?? new Date();
  const dur = end.getTime() - f.from.getTime();
  if (dur <= 0) return null;
  return { from: new Date(f.from.getTime() - dur), to };
}

/**
 * Rich spending breakdown for the drill-down UI: per category, the
 * subcategory (pfc_detailed) split, top merchants, and the period-over-period
 * trend. Assembled from a few grouped queries (no N+1 per category).
 */
export async function spendingDrilldown(
  f: SpendingFilter = {},
  merchantsPerCategory = 5,
): Promise<SpendingDrilldown> {
  const [primaryRows, detailedRows, merchantRows] = await Promise.all([
    db
      .select({
        category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(sql`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`),
    db
      .select({
        category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        detailed: sql<string>`coalesce(${transactions.pfcDetailed}, 'OTHER')`,
        totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(
        sql`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        sql`coalesce(${transactions.pfcDetailed}, 'OTHER')`,
      ),
    db
      .select({
        category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
        totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(
        sql`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        sql`coalesce(${transactions.merchantName}, ${transactions.name})`,
      ),
  ]);

  // Previous-window totals per category (for trend), if a range is set.
  const prev = previousWindow(f);
  const prevByCategory = new Map<string, number>();
  if (prev) {
    const prevFilter = { from: prev.from, to: prev.to, accountId: f.accountId };
    const prevRows = await db
      .select({
        category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
        totalCents: sql<number>`sum(${windowAmountCents(prevFilter)})::int`,
      })
      .from(transactions)
      .where(spendingWhere(prevFilter))
      .groupBy(sql`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`);
    for (const r of prevRows) prevByCategory.set(r.category, r.totalCents ?? 0);
  }

  const detailedByCat = new Map<string, DetailedSpend[]>();
  for (const r of detailedRows) {
    const list = detailedByCat.get(r.category) ?? [];
    list.push({ detailed: r.detailed, totalCents: r.totalCents ?? 0, count: r.count });
    detailedByCat.set(r.category, list);
  }
  const merchantsByCat = new Map<string, MerchantSpend[]>();
  for (const r of merchantRows) {
    const list = merchantsByCat.get(r.category) ?? [];
    list.push({ merchant: r.merchant, totalCents: r.totalCents ?? 0, count: r.count });
    merchantsByCat.set(r.category, list);
  }

  const total = primaryRows.reduce((n, r) => n + (r.totalCents ?? 0), 0);

  const categories: CategoryDrilldown[] = primaryRows
    .map((r) => {
      const totalCents = r.totalCents ?? 0;
      const prevCents = prev ? (prevByCategory.get(r.category) ?? 0) : null;
      const trendPct =
        prevCents && prevCents > 0 ? Math.round(((totalCents - prevCents) / prevCents) * 100) : null;
      return {
        category: r.category,
        totalCents,
        count: r.count,
        pct: total > 0 ? Math.round((totalCents / total) * 100) : 0,
        detailed: (detailedByCat.get(r.category) ?? []).sort((a, b) => b.totalCents - a.totalCents),
        topMerchants: (merchantsByCat.get(r.category) ?? [])
          .sort((a, b) => b.totalCents - a.totalCents)
          .slice(0, merchantsPerCategory),
        prevCents,
        trendPct,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  return { totalCents: total, categories };
}

/**
 * A fingerprint of the spending in a range: transaction count, summed amount,
 * and the latest updated_at. Changes whenever anything in scope is added,
 * edited, or removed — used to invalidate cached AI insights.
 */
export async function spendingFingerprint(f: SpendingFilter = {}): Promise<string> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(${windowAmountCents(f)}), 0)::bigint`,
      latest: sql<string>`coalesce(max(${transactions.updatedAt})::text, '')`,
    })
    .from(transactions)
    .where(spendingWhere(f));
  return `${row?.count ?? 0}:${row?.sum ?? 0}:${row?.latest ?? ""}`;
}

/** Top merchants by spend, optionally scoped to a category, for the AI agent. */
export async function topMerchants(
  f: SpendingFilter & { category?: string; detailed?: string | string[]; sort?: "spend" | "visits" } = {},
  limit = 10,
): Promise<MerchantSpend[]> {
  const clauses: SQL[] = [];
  const base = spendingWhere(f);
  if (base) clauses.push(base);
  if (f.category) clauses.push(sql`${effectiveCategory} = ${f.category}`);
  const det = detailedClause(f.detailed);
  if (det) clauses.push(det);

  // "visits" ranks by how often the user goes there; "spend" (default) by total dollars.
  const order =
    f.sort === "visits"
      ? sql`count(*) desc, sum(${windowAmountCents(f)}) desc`
      : sql`sum(${windowAmountCents(f)}) desc`;

  const rows = await db
    .select({
      merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      totalCents: sql<number>`sum(${windowAmountCents(f)})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...clauses))
    .groupBy(sql`coalesce(${transactions.merchantName}, ${transactions.name})`)
    .orderBy(order)
    .limit(limit);
  return rows.map((r) => ({ merchant: r.merchant, totalCents: r.totalCents ?? 0, count: r.count }));
}

/** Count of transactions matching a filter (for pagination). */
export async function countTransactions(f: TxnFilter = {}): Promise<number> {
  const clauses: SQL[] = [];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  if (f.category) clauses.push(sql`${effectiveCategory} = ${f.category}`);
  if (f.search) {
    const q = `%${f.search}%`;
    clauses.push(sql`(${ilike(transactions.name, q)} or ${ilike(transactions.merchantName, q)})`);
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(clauses.length ? and(...clauses) : undefined);
  return row?.n ?? 0;
}

/** Distinct accounts for filter dropdowns (friendly names). */
export async function listAccountsForFilter(): Promise<Pick<Account, "id" | "name">[]> {
  return db
    .select({ id: accounts.id, name: displayName })
    .from(accounts)
    .leftJoin(cards, eq(cards.accountId, accounts.id))
    .orderBy(accounts.name);
}

// Peer-to-peer app payments (Venmo/Zelle/CashApp), both directions. Detailed
// codes live in spend-sql. A payment the user has categorized has been promoted
// to real spend, so it drops out of the net view below (no double-counting);
// what remains here is reimbursements plus outgoing payments not yet reviewed.

export interface P2PTxn {
  name: string;
  amountCents: number; // >0 sent, <0 received
  postedAt: Date | null;
}
export interface P2PNet {
  outCents: number; // total sent (>=0)
  inCents: number; // total received (<=0)
  netCents: number; // out + in = net out-of-pocket
  outCount: number;
  inCount: number;
  transactions: P2PTxn[];
}

/** Time/account scoping shared by the P2P + excluded-bucket helpers (no spend filter). */
function timeAccountClauses(f: SpendingFilter): SQL[] {
  const clauses: SQL[] = [sql`${transactions.pending} = false`];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  return clauses;
}

/**
 * Net peer-to-peer spending: money sent via apps minus money received back
 * (reimbursements). Only app-to-app is netted — cross-channel reimbursements
 * (e.g. a bank deposit) are intentionally NOT offset here. See the budgets page.
 */
export async function peerToPeerNet(f: SpendingFilter = {}): Promise<P2PNet> {
  const clauses = timeAccountClauses(f);
  clauses.push(sql`${transactions.pfcDetailed} in (${P2P_OUT_DETAILED}, ${P2P_IN_DETAILED})`);
  // Categorized/ignored outgoing payments have been handled — exclude them so
  // they aren't counted a second time here.
  clauses.push(sql`${transactions.userCategory} is null`);
  const rows = await db
    .select({
      name: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
    })
    .from(transactions)
    .where(and(...clauses))
    .orderBy(sql`${transactions.amountCents} desc`);

  let outCents = 0;
  let inCents = 0;
  let outCount = 0;
  let inCount = 0;
  for (const r of rows) {
    if (r.amountCents > 0) {
      outCents += r.amountCents;
      outCount++;
    } else if (r.amountCents < 0) {
      inCents += r.amountCents;
      inCount++;
    }
  }
  return { outCents, inCents, netCents: outCents + inCents, outCount, inCount, transactions: rows };
}

export interface ExcludedSummary {
  internalTransfersCents: number; // non-P2P transfers out (savings, investing, account moves)
  ccPaymentsCents: number; // credit-card payments (purchases already counted on the card)
  inflowsCents: number; // money in (income, refunds, deposits), excluding P2P reimbursements
  ignoredCents: number; // rows the user marked "not spending" (IGNORE)
  /**
   * Cash that left this window for charges budgeted to a different month, MINUS
   * what other months' charges put on this one. Covers premiums spread across
   * their term and charges pinned to the month they cover (an August lease paid
   * in July). Negative when this window is absorbing earlier months' money.
   */
  deferredCents: number;
}

/**
 * Everything the budgets page does NOT count as spending, bucketed — so the page
 * can show where 100% of the month's money movement went (nothing silently dropped).
 */
export async function excludedSummary(f: SpendingFilter = {}): Promise<ExcludedSummary> {
  const where = and(...timeAccountClauses(f));
  const [row] = await db
    .select({
      internal: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 and coalesce(${transactions.pfcPrimary}, '') in ('TRANSFER_OUT', 'TRANSFER_IN') and coalesce(${transactions.pfcDetailed}, '') <> ${P2P_OUT_DETAILED} then ${transactions.amountCents} else 0 end), 0)::int`,
      cc: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 and coalesce(${transactions.pfcDetailed}, '') = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then ${transactions.amountCents} else 0 end), 0)::int`,
      inflow: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 and coalesce(${transactions.pfcDetailed}, '') <> ${P2P_IN_DETAILED} then ${transactions.amountCents} else 0 end), 0)::int`,
      // Own-bank moves land here too: Plaid files them as LOAN_PAYMENTS, but the
      // user confirmed they're transfers between their own banks.
      own: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 and ${isOwnBankTransfer} then ${transactions.amountCents} else 0 end), 0)::int`,
      ignored: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 and ${isIgnored} and not ${isOwnBankTransfer} then ${transactions.amountCents} else 0 end), 0)::int`,
    })
    .from(transactions)
    .where(where);

  // Money that left the account in one month but is budgeted to another, so the
  // footer still adds up to 100%. `paid` is cash that actually left in this
  // window; `charged` is what this window is budgeted for, which can come from a
  // charge posted in an earlier month — so the row set is every shifted charge,
  // not just this window's.
  const paidHere = cashPaidInWindow(f);

  const [amort] = await db
    .select({
      paid: sql<number>`coalesce(sum(case when ${paidHere} then ${transactions.amountCents} else 0 end), 0)::int`,
      // Gated on inWindow: a non-amortized row contributes its full amount from
      // windowAmountCents (callers normally apply the date filter separately),
      // and this query deliberately scans every shifted row, not just this
      // window's.
      charged: sql<number>`coalesce(sum(case when ${inWindow(f)} then ${windowAmountCents(f)} else 0 end), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        sql`((${transactions.amortizeMonths} is not null and ${transactions.amortizeMonths} > 1) or ${transactions.budgetMonth} is not null)`,
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.pending} = false`,
        spendRowPredicate(),
        ...(f.accountId ? [eq(transactions.accountId, f.accountId)] : []),
      ),
    );

  return {
    internalTransfersCents: (row?.internal ?? 0) + (row?.own ?? 0),
    ccPaymentsCents: row?.cc ?? 0,
    inflowsCents: row?.inflow ?? 0,
    ignoredCents: row?.ignored ?? 0,
    deferredCents: (amort?.paid ?? 0) - (amort?.charged ?? 0),
  };
}

/** One amortized charge as it applies to a window (for the "spread" label). */
export interface AmortizedCharge {
  category: string;
  merchant: string;
  postedAt: Date | null;
  totalCents: number; // the full charge
  months: number; // how many months it's spread across
  monthIndex: number; // 1-based month of the spread this window is showing
  windowCents: number; // the slice charged to this window
}

/**
 * Amortized charges touching a window, so the budgets page can say *why* a
 * category shows less than the bill ("month 2 of 6 of a $414.88 premium").
 */
export async function amortizedCharges(f: SpendingFilter = {}): Promise<AmortizedCharge[]> {
  const monthOffset = f.from
    ? sql<number>`(${f.from.getUTCFullYear() * 12 + f.from.getUTCMonth()} - (extract(year from ${budgetAt})::int * 12 + extract(month from ${budgetAt})::int - 1))`
    : sql<number>`0`;

  const rows = await db
    .select({
      category: sql<string>`coalesce(${effectiveCategory}, 'UNCATEGORIZED')`,
      merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      postedAt: transactions.postedAt,
      totalCents: transactions.amountCents,
      months: transactions.amortizeMonths,
      monthIndex: sql<number>`(${monthOffset} + 1)::int`,
      windowCents: sql<number>`${windowAmountCents(f)}::int`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.amortizeMonths} is not null and ${transactions.amortizeMonths} > 1`,
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.pending} = false`,
        spendRowPredicate(),
        inWindow(f),
        ...(f.accountId ? [eq(transactions.accountId, f.accountId)] : []),
      ),
    );

  return rows.map((r) => ({
    category: r.category,
    merchant: r.merchant,
    postedAt: r.postedAt,
    totalCents: r.totalCents,
    months: r.months ?? 1,
    monthIndex: r.monthIndex,
    windowCents: r.windowCents,
  }));
}

export interface UncategorizedP2P {
  id: string;
  name: string; // merchant/counterparty, e.g. the person paid
  amountCents: number; // > 0 (outflow)
  postedAt: Date | null;
  accountName: string;
}

/**
 * Outgoing peer-to-peer app payments the user hasn't reviewed yet
 * (user_category IS NULL). These are the rows the categorize screen works
 * through. Only outflows — received money stays a reimbursement (see spec).
 */
export async function listUncategorizedP2P(limit = 100): Promise<UncategorizedP2P[]> {
  return db
    .select({
      id: transactions.id,
      name: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
      accountName: displayName,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(
      and(
        eq(transactions.pfcDetailed, P2P_OUT_DETAILED),
        eq(transactions.pending, false),
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.userCategory} is null`,
      ),
    )
    .orderBy(desc(transactions.postedAt))
    .limit(limit);
}

/** How many outgoing P2P payments still need a category (drives the banner). */
export async function countUncategorizedP2P(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.pfcDetailed, P2P_OUT_DETAILED),
        eq(transactions.pending, false),
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.userCategory} is null`,
      ),
    );
  return row?.n ?? 0;
}
