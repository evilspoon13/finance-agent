import { and, gte, lte, eq, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db } from "./client";
import { accounts, transactions, holdings, type Account } from "./schema";

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
    lines.push({ accountId: a.id, name: a.name, klass, valueCents: value });
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

function spendingWhere(f: SpendingFilter): SQL | undefined {
  const clauses: SQL[] = [
    // Outflows only (positive = money leaving the account).
    sql`${transactions.amountCents} > 0`,
    sql`${transactions.pending} = false`,
  ];
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
      name: accounts.name,
      totalCents: sql<number>`sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(spendingWhere(f))
    .groupBy(transactions.accountId, accounts.name)
    .orderBy(sql`sum(${transactions.amountCents}) desc`);
  return rows.map((r) => ({ accountId: r.accountId, name: r.name, totalCents: r.totalCents ?? 0 }));
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
      accountName: accounts.name,
      category: transactions.pfcPrimary,
      amountCents: transactions.amountCents,
      pending: transactions.pending,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(transactions.postedAt))
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);
  return rows;
}

/** Distinct accounts for filter dropdowns. */
export async function listAccountsForFilter(): Promise<Pick<Account, "id" | "name">[]> {
  return db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(accounts.name);
}
