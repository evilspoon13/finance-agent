import { and, gte, lte, eq, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { accounts, transactions, cards, type Account } from "../schema";
import { effectiveCategory, spendRowPredicate, windowAmountCents, inWindow, budgetAt } from "../spend-sql";
import { displayName, type SpendingFilter, spendingWhere } from "./shared";

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

export interface TxnFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
  category?: string;
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
  category: string | null; // effective: the override when set, else Plaid's
  plaidCategory: string | null;
  // The user's overrides, for the transaction editor.
  userCategory: string | null;
  memo: string | null;
  budgetMonth: string | null; // "YYYY-MM-DD"
  amortizeMonths: number | null;
  reimbursedCents: number | null;
  amountCents: number;
  pending: boolean;
}

/** Shared WHERE for the transaction list and its count. */
function txnWhere(f: TxnFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  if (f.category) clauses.push(sql`${effectiveCategory} = ${f.category}`);
  if (f.search) {
    const q = `%${f.search}%`;
    clauses.push(sql`(${ilike(transactions.name, q)} or ${ilike(transactions.merchantName, q)})`);
  }
  return clauses.length ? and(...clauses) : undefined;
}

export async function listTransactions(f: TxnFilter = {}): Promise<TxnRow[]> {

  const rows = await db
    .select({
      id: transactions.id,
      postedAt: transactions.postedAt,
      name: transactions.name,
      merchantName: transactions.merchantName,
      accountName: displayName,
      category: effectiveCategory,
      plaidCategory: transactions.pfcPrimary,
      userCategory: transactions.userCategory,
      memo: transactions.userMemo,
      budgetMonth: transactions.budgetMonth,
      amortizeMonths: transactions.amortizeMonths,
      reimbursedCents: transactions.reimbursedCents,
      amountCents: transactions.amountCents,
      pending: transactions.pending,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(txnWhere(f))
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

/** Count of transactions matching a filter (for pagination). */
export async function countTransactions(f: TxnFilter = {}): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(txnWhere(f));
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
