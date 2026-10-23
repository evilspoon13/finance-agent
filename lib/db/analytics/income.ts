import { and, gte, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { accounts, transactions } from "../schema";

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
