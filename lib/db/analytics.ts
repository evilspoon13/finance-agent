import { and, gte, lte, eq, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db } from "./client";
import { accounts, transactions, holdings, cards, type Account } from "./schema";

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

export interface SpendingFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
}

// Categories that represent money movement, not consumption. Excluded from
// spending views so inter-account transfers and credit-card payments don't
// inflate totals or double-count card purchases. (Mortgage/auto/student-loan
// payments stay in — only the credit-card-payment detail is dropped.)
const NON_SPEND_PRIMARY = ["TRANSFER_IN", "TRANSFER_OUT"];
const NON_SPEND_DETAILED = ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];

function spendingWhere(f: SpendingFilter): SQL | undefined {
  const clauses: SQL[] = [
    // Outflows only (positive = money leaving the account).
    sql`${transactions.amountCents} > 0`,
    sql`${transactions.pending} = false`,
  ];
  for (const p of NON_SPEND_PRIMARY) {
    clauses.push(sql`coalesce(${transactions.pfcPrimary}, '') <> ${p}`);
  }
  for (const d of NON_SPEND_DETAILED) {
    clauses.push(sql`coalesce(${transactions.pfcDetailed}, '') <> ${d}`);
  }
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  return and(...clauses);
}

export interface CategorySpend {
  category: string;
  totalCents: number;
  count: number;
}

export async function spendingByCategory(f: SpendingFilter = {}): Promise<CategorySpend[]> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
      totalCents: sql<number>`sum(${transactions.amountCents})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(spendingWhere(f))
    .groupBy(sql`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`)
    .orderBy(sql`sum(${transactions.amountCents}) desc`);
  return rows.map((r) => ({ category: r.category, totalCents: r.totalCents ?? 0, count: r.count }));
}

export interface MonthSpend {
  month: string; // YYYY-MM
  totalCents: number;
}

export async function spendingByMonth(f: SpendingFilter = {}): Promise<MonthSpend[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${transactions.postedAt}), 'YYYY-MM')`,
      totalCents: sql<number>`sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .where(spendingWhere(f))
    .groupBy(sql`date_trunc('month', ${transactions.postedAt})`)
    .orderBy(sql`date_trunc('month', ${transactions.postedAt}) desc`);
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
      totalCents: sql<number>`sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(spendingWhere(f))
    .groupBy(transactions.accountId, accounts.name, cards.label)
    .orderBy(sql`sum(${transactions.amountCents}) desc`);
  return rows.map((r) => ({ accountId: r.accountId, name: r.name, totalCents: r.totalCents ?? 0 }));
}

export interface TxnFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
  category?: string;
  detailed?: string;
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
  amountCents: number;
  pending: boolean;
}

export async function listTransactions(f: TxnFilter = {}): Promise<TxnRow[]> {
  const clauses: SQL[] = [];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  if (f.category) clauses.push(eq(transactions.pfcPrimary, f.category));
  if (f.detailed) clauses.push(eq(transactions.pfcDetailed, f.detailed));
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
      category: transactions.pfcPrimary,
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
        category: sql<string>`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        totalCents: sql<number>`sum(${transactions.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(sql`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`),
    db
      .select({
        category: sql<string>`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        detailed: sql<string>`coalesce(${transactions.pfcDetailed}, 'OTHER')`,
        totalCents: sql<number>`sum(${transactions.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(
        sql`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        sql`coalesce(${transactions.pfcDetailed}, 'OTHER')`,
      ),
    db
      .select({
        category: sql<string>`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
        totalCents: sql<number>`sum(${transactions.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingWhere(f))
      .groupBy(
        sql`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        sql`coalesce(${transactions.merchantName}, ${transactions.name})`,
      ),
  ]);

  // Previous-window totals per category (for trend), if a range is set.
  const prev = previousWindow(f);
  const prevByCategory = new Map<string, number>();
  if (prev) {
    const prevRows = await db
      .select({
        category: sql<string>`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`,
        totalCents: sql<number>`sum(${transactions.amountCents})::int`,
      })
      .from(transactions)
      .where(spendingWhere({ from: prev.from, to: prev.to, accountId: f.accountId }))
      .groupBy(sql`coalesce(${transactions.pfcPrimary}, 'UNCATEGORIZED')`);
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
      sum: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::bigint`,
      latest: sql<string>`coalesce(max(${transactions.updatedAt})::text, '')`,
    })
    .from(transactions)
    .where(spendingWhere(f));
  return `${row?.count ?? 0}:${row?.sum ?? 0}:${row?.latest ?? ""}`;
}

/** Top merchants by spend, optionally scoped to a category, for the AI agent. */
export async function topMerchants(
  f: SpendingFilter & { category?: string; detailed?: string } = {},
  limit = 10,
): Promise<MerchantSpend[]> {
  const clauses: SQL[] = [];
  const base = spendingWhere(f);
  if (base) clauses.push(base);
  if (f.category) clauses.push(eq(transactions.pfcPrimary, f.category));
  if (f.detailed) clauses.push(eq(transactions.pfcDetailed, f.detailed));

  const rows = await db
    .select({
      merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      totalCents: sql<number>`sum(${transactions.amountCents})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...clauses))
    .groupBy(sql`coalesce(${transactions.merchantName}, ${transactions.name})`)
    .orderBy(sql`sum(${transactions.amountCents}) desc`)
    .limit(limit);
  return rows.map((r) => ({ merchant: r.merchant, totalCents: r.totalCents ?? 0, count: r.count }));
}

/** Count of transactions matching a filter (for pagination). */
export async function countTransactions(f: TxnFilter = {}): Promise<number> {
  const clauses: SQL[] = [];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  if (f.category) clauses.push(eq(transactions.pfcPrimary, f.category));
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
