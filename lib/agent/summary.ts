import { and, desc, gte, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { investmentTransactions, items, transactions } from "@/lib/db/schema";
import { getNetWorth, getInvestments, getIncomeSummary, spendingByCategory, countUncategorizedP2P } from "@/lib/db/analytics";
import { getNetWorthHistory } from "@/lib/db/net-worth-history";
import { budgetProgress } from "@/lib/db/budget-queries";
import { effectiveCategory, spendRowPredicate } from "@/lib/db/spend-sql";
import { analyzeRewards } from "@/lib/rewards/compute";
import { getContext, listActions, listBriefings, GOALS_KEY, NOTES_KEY } from "@/lib/db/agent-queries";
import { savingsForWindow, type WindowSavings } from "./savings";
import { FI_MULTIPLE, REAL_RETURN, yearsToTarget } from "./fire";
import { CONTRIBUTION_LIMITS } from "./limits";
import { projectMonthEnd } from "./projection";

/**
 * The agent's starting picture, built from the same functions the pages use so
 * its numbers match the app. Money is in dollars (2 dp): easier for a model to
 * read than cents. See docs/agent.md for what each section means.
 */

const usd = (cents: number) => Math.round(cents) / 100;
const DAY = 864e5;
const STALE_SYNC_HOURS = 48;

function savingsView(label: string, s: WindowSavings) {
  return {
    period: label,
    incomeUsd: usd(s.incomeCents),
    netPayUsd: usd(s.netPayCents),
    otherIncomeUsd: usd(s.otherIncomeCents),
    payrollRetirementUsd: usd(s.payrollRetirementCents),
    spentUsd: usd(s.spentCents),
    savedUsd: usd(s.savedCents),
    savingsRatePct: s.savingsRatePct,
    investedUsd: Object.fromEntries(Object.entries(s.investedCents).map(([k, v]) => [k, usd(v)])),
    cashKeptUsd: usd(s.cashKeptCents),
  };
}

function monthBounds(year: number, month: number) {
  return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)) };
}

export async function buildAgentSummary(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const monthStart = new Date(Date.UTC(y, m, 1));

  const yearStart = new Date(Date.UTC(y, 0, 1));
  const fullMonths = [1, 2, 3].map((back) => {
    const d = new Date(Date.UTC(y, m - back, 1));
    return { label: d.toISOString().slice(0, 7), ...monthBounds(d.getUTCFullYear(), d.getUTCMonth()) };
  });

  const [
    netWorth,
    history,
    investments,
    income,
    budgets,
    pastMonths,
    uncategorizedP2P,
    uncategorizedP2P30d,
    rewards,
    goals,
    notes,
    actions,
    briefings,
    savingsMtd,
    savingsYtd,
    savingsMonths,
    staleItems,
  ] = await Promise.all([
      getNetWorth(),
      getNetWorthHistory(400),
      getInvestments(),
      getIncomeSummary(now),
      budgetProgress(now),
      Promise.all(
        [1, 2, 3].map(async (back) => {
          const d = new Date(Date.UTC(y, m - back, 1));
          const rows = await spendingByCategory(monthBounds(d.getUTCFullYear(), d.getUTCMonth()));
          return {
            month: d.toISOString().slice(0, 7),
            totalUsd: usd(rows.reduce((s, r) => s + r.totalCents, 0)),
            byCategory: Object.fromEntries(rows.map((r) => [r.category, usd(r.totalCents)])),
          };
        }),
      ),
      countUncategorizedP2P(),
      countUncategorizedP2P(since30),
      analyzeRewards({ from: since30, to: now }),
      getContext(GOALS_KEY),
      getContext(NOTES_KEY),
      listActions(),
      listBriefings(5),
      savingsForWindow({ from: monthStart, to: now }),
      savingsForWindow({ from: yearStart, to: now }),
      Promise.all(fullMonths.map(async (w) => ({ label: w.label, s: await savingsForWindow(w) }))),
      // Linked items that need a re-login or haven't synced lately.
      db
        .select({ institution: items.institutionName, status: items.status, lastSynced: items.updatedAt })
        .from(items)
        .where(
          and(
            sql`${items.id} not like 'manual\_%'`,
            or(ne(items.status, "good"), lt(items.updatedAt, new Date(now.getTime() - STALE_SYNC_HOURS * 3600e3))),
          ),
        ),
    ]);

  // Net worth N days ago: the latest snapshot on or before that day.
  const byDay = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const netWorthAgo = (days: number) => {
    const cutoff = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
    const point = byDay.filter((p) => p.day <= cutoff).at(-1);
    return point ? { asOf: point.day, changeUsd: usd(netWorth.netWorthCents - point.netWorthCents) } : null;
  };

  const [investmentFlows, largeTransactions, newMerchants] = await Promise.all([
    // Cash movements into/out of investment accounts over 90 days, by kind of
    // activity (contributions, buys, dividends...). Positive = cash out (a buy).
    db
      .select({
        accountId: investmentTransactions.accountId,
        type: investmentTransactions.type,
        subtype: investmentTransactions.subtype,
        cents: sql<number>`sum(${investmentTransactions.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(investmentTransactions)
      .where(gte(investmentTransactions.postedAt, since90))
      .groupBy(investmentTransactions.accountId, investmentTransactions.type, investmentTransactions.subtype),
    // The week's biggest spending rows.
    db
      .select({
        postedAt: transactions.postedAt,
        merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
        category: effectiveCategory,
        cents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.amountCents} >= 10000`,
          sql`${transactions.pending} = false`,
          gte(transactions.postedAt, since7),
          spendRowPredicate(),
        ),
      )
      .orderBy(desc(transactions.amountCents))
      .limit(15),
    // Merchants whose first-ever spending row is this month (new subscriptions, etc.).
    db
      .select({
        merchant: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
        firstSeen: sql<string>`min(${transactions.postedAt})::date::text`,
        cents: sql<number>`sum(${transactions.amountCents})::int`,
      })
      .from(transactions)
      .where(and(sql`${transactions.amountCents} > 0`, spendRowPredicate()))
      .groupBy(sql`coalesce(${transactions.merchantName}, ${transactions.name})`)
      .having(sql`min(${transactions.postedAt}) >= ${monthStart.toISOString()}::timestamptz`)
      .orderBy(desc(sql`sum(${transactions.amountCents})`))
      .limit(20),
  ]);

  const accountName = new Map(investments.accounts.map((a) => [a.accountId, a.name]));

  // Run rates from the last full months that have income data (skips months
  // before accounts were linked).
  const observed = savingsMonths.filter((x) => x.s.incomeCents > 0);
  const avg = (f: (s: WindowSavings) => number) =>
    observed.length ? observed.reduce((t, x) => t + f(x.s), 0) / observed.length : 0;
  const monthlySpendCents = avg((s) => s.spentCents);
  const monthlySavedCents = avg((s) => s.savedCents);
  const annualSpendCents = monthlySpendCents * 12;
  const fiNumberCents = annualSpendCents * FI_MULTIPLE;
  const investedCents = investments.totalValueCents;
  const cashCents = netWorth.lines.filter((l) => l.klass === "cash").reduce((t, l) => t + l.valueCents, 0);
  const years = yearsToTarget(investedCents, monthlySavedCents * 12, fiNumberCents);
  const limits = CONTRIBUTION_LIMITS[y] ?? null;

  return {
    asOf: now.toISOString(),
    goals: goals ?? "(no goals set yet — they live in Settings → Goals)",
    notes: notes ?? "(no notes yet — save what you learn with PUT /api/agent/notes)",
    actions: actions.map((a) => ({
      id: a.id,
      title: a.title,
      detail: a.detail,
      dueOn: a.dueOn,
      status: a.status,
      note: a.note,
      createdAt: a.createdAt.toISOString().slice(0, 10),
      resolvedAt: a.resolvedAt?.toISOString().slice(0, 10) ?? null,
    })),
    savings: {
      thisMonthSoFar: savingsView(monthStart.toISOString().slice(0, 7), savingsMtd),
      lastFullMonths: savingsMonths.map((x) => savingsView(x.label, x.s)),
      yearToDate: savingsView(String(y), savingsYtd),
    },
    fire: {
      investedAssetsUsd: usd(investedCents),
      monthlySpendingRunRateUsd: usd(monthlySpendCents),
      monthlySavedRunRateUsd: usd(monthlySavedCents),
      runRateMonths: observed.map((x) => x.label),
      fiNumberAtCurrentSpendingUsd: usd(fiNumberCents),
      progressPct: fiNumberCents > 0 ? Math.round((investedCents / fiNumberCents) * 1000) / 10 : null,
      yearsToFI: years === null ? null : Math.round(years * 10) / 10,
      assumptions: { fiMultiple: FI_MULTIPLE, realReturn: REAL_RETURN },
    },
    cash: {
      totalUsd: usd(cashCents),
      monthsOfSpending: monthlySpendCents > 0 ? Math.round((cashCents / monthlySpendCents) * 10) / 10 : null,
    },
    contributionsThisYear: {
      year: y,
      depositedUsd: Object.fromEntries(Object.entries(savingsYtd.investedCents).map(([k, v]) => [k, usd(v)])),
      limitsUsd: limits,
    },
    connectionsNeedingAttention: staleItems.map((i) => ({
      institution: i.institution,
      status: i.status,
      lastSynced: i.lastSynced.toISOString(),
    })),
    netWorth: {
      netWorthUsd: usd(netWorth.netWorthCents),
      assetsUsd: usd(netWorth.assetsCents),
      liabilitiesUsd: usd(netWorth.liabilitiesCents),
      change30d: netWorthAgo(30),
      change90d: netWorthAgo(90),
      change365d: netWorthAgo(365),
      accounts: netWorth.lines.map((l) => ({ name: l.name, class: l.klass, valueUsd: usd(l.valueCents) })),
    },
    investments: {
      totalUsd: usd(investments.totalValueCents),
      gainUsd: usd(investments.totalGainCents),
      accounts: investments.accounts.map((a) => ({
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        valueUsd: usd(a.valueCents),
        gainUsd: usd(a.gainCents),
      })),
      flows90d: investmentFlows.map((f) => ({
        account: accountName.get(f.accountId) ?? f.accountId,
        type: f.type,
        subtype: f.subtype,
        usd: usd(f.cents),
        count: f.count,
      })),
    },
    income: {
      ytdUsd: usd(income.ytdCents),
      last12moUsd: usd(income.last12moCents),
      recentPaychecks: income.paychecks.slice(0, 6).map((p) => ({
        date: p.postedAt?.toISOString().slice(0, 10) ?? null,
        employer: p.employer,
        usd: usd(p.amountCents),
      })),
    },
    budgetsThisMonth: {
      month: monthStart.toISOString().slice(0, 7),
      daysRemaining: budgets[0]?.daysRemaining ?? null,
      categories: budgets.map((b) => ({
        category: b.category,
        limitUsd: usd(b.monthlyLimitCents),
        spentUsd: usd(b.spentCents),
        pct: b.pct,
        straightLineProjectionUsd: usd(projectMonthEnd(b.spentCents, now)),
      })),
      totalLimitUsd: usd(budgets.reduce((s, b) => s + b.monthlyLimitCents, 0)),
      totalSpentUsd: usd(budgets.reduce((s, b) => s + b.spentCents, 0)),
    },
    spendingLastThreeMonths: pastMonths,
    watchList: {
      uncategorizedP2PPayments: { allTime: uncategorizedP2P, last30d: uncategorizedP2P30d },
      missedRewards30d: {
        totalUsd: usd(rewards.totalMissedCents),
        top: rewards.missed.slice(0, 5).map((r) => ({
          date: r.postedAt?.toISOString().slice(0, 10) ?? null,
          merchant: r.label,
          used: r.actualLabel,
          better: r.optimalLabel,
          missedUsd: usd(r.deltaCents),
        })),
      },
      largeTransactions7d: largeTransactions.map((t) => ({
        date: t.postedAt?.toISOString().slice(0, 10) ?? null,
        merchant: t.merchant,
        category: t.category,
        usd: usd(t.cents),
      })),
      newMerchantsThisMonth: newMerchants.map((n) => ({ merchant: n.merchant, firstSeen: n.firstSeen, usd: usd(n.cents) })),
    },
    recentBriefings: briefings.map((b) => ({
      date: b.createdAt.toISOString(),
      kind: b.kind,
      title: b.title,
      notified: b.notified,
      body: b.body,
    })),
  };
}
