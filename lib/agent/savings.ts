import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, investmentTransactions, transactions } from "@/lib/db/schema";
import { spendingByCategory } from "@/lib/db/analytics";
import { investmentKind, type InvestmentKind } from "@/lib/db/analytics/investments";
import { savingsRatePct } from "./fire";

/**
 * Savings rate from what the accounts can see, for one window:
 *
 *   income  = net paychecks + other bank income + payroll retirement contributions
 *   saved   = income − spending
 *   rate    = saved / income
 *
 * Payroll retirement contributions are the `contribution` rows on 401(k)-type
 * accounts: money from pay that never reached the bank. Plaid can't split the
 * employee part from the employer match. Payroll HSA deposits and RSU/bonus money
 * that arrives as a transfer aren't visible as income; docs/agent.md says how the
 * agent adjusts using the profile in the goals doc.
 *
 * `invested` is net new money into investment accounts (contributions and
 * transfers in, minus transfers out), by kind; `cashKept` is the rest of what was
 * saved, i.e. growth in cash.
 */

export interface Window {
  from: Date;
  to: Date;
}

const DEPOSIT_SUBTYPES = ["contribution", "deposit", "withdrawal", "transfer"];

export async function savingsForWindow(w: Window) {
  const bank = sql`${transactions.accountId} in (select ${accounts.id} from ${accounts} where ${accounts.type} = 'depository')`;
  const posted = and(eq(transactions.pending, false), gte(transactions.postedAt, w.from), lte(transactions.postedAt, w.to), bank);

  const [incomeRows, spending, flows] = await Promise.all([
    db
      .select({
        netPay: sql<number>`coalesce(-sum(${transactions.amountCents}) filter (where ${transactions.pfcDetailed} = 'INCOME_SALARY'), 0)::int`,
        other: sql<number>`coalesce(-sum(${transactions.amountCents}) filter (where ${transactions.pfcDetailed} is distinct from 'INCOME_SALARY'), 0)::int`,
      })
      .from(transactions)
      .where(and(posted, eq(transactions.pfcPrimary, "INCOME"), sql`${transactions.amountCents} < 0`)),
    spendingByCategory(w),
    db
      .select({
        subtype: accounts.subtype,
        contributions: sql<number>`coalesce(-sum(${investmentTransactions.amountCents}) filter (where ${investmentTransactions.subtype} = 'contribution'), 0)::int`,
        netDeposits: sql<number>`coalesce(-sum(${investmentTransactions.amountCents}) filter (where ${investmentTransactions.type} = 'transfer' or ${inArray(investmentTransactions.subtype, DEPOSIT_SUBTYPES)}), 0)::int`,
      })
      .from(investmentTransactions)
      .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
      .where(and(gte(investmentTransactions.postedAt, w.from), lte(investmentTransactions.postedAt, w.to)))
      .groupBy(accounts.subtype),
  ]);

  const income = incomeRows[0] ?? { netPay: 0, other: 0 };
  const invested: Partial<Record<InvestmentKind, number>> = {};
  let payrollRetirement = 0;
  for (const f of flows) {
    const kind = investmentKind(f.subtype);
    invested[kind] = (invested[kind] ?? 0) + f.netDeposits;
    if (kind === "401k") payrollRetirement += f.contributions;
  }

  const incomeCents = income.netPay + income.other + payrollRetirement;
  const spentCents = spending.reduce((s, r) => s + r.totalCents, 0);
  const investedCents = Object.values(invested).reduce((s, v) => s + v, 0);
  return {
    incomeCents,
    netPayCents: income.netPay,
    otherIncomeCents: income.other,
    payrollRetirementCents: payrollRetirement,
    spentCents,
    savedCents: incomeCents - spentCents,
    savingsRatePct: savingsRatePct(incomeCents, spentCents),
    investedCents: invested,
    totalInvestedCents: investedCents,
    cashKeptCents: incomeCents - spentCents - investedCents,
  };
}

export type WindowSavings = Awaited<ReturnType<typeof savingsForWindow>>;
