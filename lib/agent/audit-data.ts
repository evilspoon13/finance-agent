import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, items, transactions } from "@/lib/db/schema";
import { budgetAt, REIMBURSEMENT_CATEGORY, spendRowPredicate } from "@/lib/db/spend-sql";
import { auditTransactions, type AuditRow } from "./audit";
import { forecastAccount, type CardPayment } from "./cashflow";
import { CARD_PAYMENT, detectRecurring, median, merchantKey, type FlowRow } from "./recurring";
import { projectWithFixedBills } from "./projection";

/**
 * Loads what the spending audit needs and runs the pure checks over it. `now` is
 * a parameter so the forecast can be replayed against a past date.
 */

const DAY = 864e5;
const HISTORY_DAYS = 200;
const RECENT_DAYS = 30;
const PENDING_WINDOW_DAYS = 7;
const HORIZON_DAYS = 45;
const REIMBURSEMENT_WINDOW_DAYS = 90;

type Row = FlowRow & AuditRow & { pfcPrimary: string | null; budgetMonth: string };

export async function loadRows(since: Date): Promise<Row[]> {
  const rows = await db
    .select({
      accountId: transactions.accountId,
      accountName: accounts.name,
      isCard: sql<boolean>`${accounts.type} = 'credit'`,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amountCents: transactions.amountCents,
      postedAt: sql<string>`coalesce(${transactions.postedAt}, ${transactions.authorizedAt}, ${transactions.createdAt})`,
      pending: transactions.pending,
      pfcPrimary: transactions.pfcPrimary,
      pfcDetailed: transactions.pfcDetailed,
      isSpend: sql<boolean>`${spendRowPredicate()}`,
      budgetMonth: sql<string>`to_char(${budgetAt}, 'YYYY-MM')`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(sql`coalesce(${transactions.postedAt}, ${transactions.createdAt}) >= ${since.toISOString()}::timestamptz`);
  return rows.map((r) => ({ ...r, postedAt: new Date(r.postedAt) }));
}

/** Which account pays each card issuer, and around which day of the month. */
export function cardPaymentHabits(rows: Row[], cards: { institution: string | null; balanceCents: number }[]): CardPayment[] {
  const payments = rows.filter((r) => r.pfcDetailed === CARD_PAYMENT && r.amountCents > 0 && !r.pending);
  const byIssuer = new Map<string, number>();
  for (const c of cards) {
    if (c.institution) byIssuer.set(c.institution, (byIssuer.get(c.institution) ?? 0) + c.balanceCents);
  }
  return [...byIssuer.entries()].flatMap(([issuer, balanceCents]) => {
    const word = issuer.split(" ")[0]!.toUpperCase();
    const mine = payments.filter((p) => merchantKey(p.name, p.merchantName).startsWith(word));
    if (!mine.length) return [];
    // The biggest payment of each month is the statement payment.
    const biggest = new Map<string, Row>();
    for (const p of mine) {
      const month = p.postedAt.toISOString().slice(0, 7);
      const best = biggest.get(month);
      if (!best || p.amountCents > best.amountCents) biggest.set(month, p);
    }
    const payers = new Map<string, number>();
    for (const p of mine) payers.set(p.accountId, (payers.get(p.accountId) ?? 0) + 1);
    const payerAccountId = [...payers.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return [{ issuer, balanceCents, payerAccountId, payDay: median([...biggest.values()].map((p) => p.postedAt.getUTCDate())) }];
  });
}

const usd = (cents: number) => Math.round(cents) / 100;

export async function buildSpendingAudit(input: {
  now: Date;
  bufferCents: number;
  ignoreMerchants: string[];
  monthSpentCents: number;
}) {
  const { now } = input;
  const [rows, acctRows, reimbursedRows] = await Promise.all([
    loadRows(new Date(now.getTime() - HISTORY_DAYS * DAY)),
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        subtype: accounts.subtype,
        balanceCents: accounts.currentBalanceCents,
        institution: items.institutionName,
      })
      .from(accounts)
      .innerJoin(items, eq(items.id, accounts.itemId)),
    db
      .select({
        fronted: sql<number>`coalesce(sum(${transactions.reimbursedCents}), 0)::int`,
        received: sql<number>`coalesce(-sum(${transactions.amountCents}) filter (where ${transactions.userCategory} = ${REIMBURSEMENT_CATEGORY}), 0)::int`,
      })
      .from(transactions)
      .where(and(gte(transactions.postedAt, new Date(now.getTime() - REIMBURSEMENT_WINDOW_DAYS * DAY)))),
  ]);

  const series = detectRecurring(rows, now);
  const cards = cardPaymentHabits(
    rows,
    acctRows.filter((a) => a.type === "credit").map((a) => ({ institution: a.institution, balanceCents: a.balanceCents ?? 0 })),
  );
  const savings = acctRows
    .filter((a) => a.subtype === "savings")
    .map((a) => ({ name: a.name, balanceCents: a.balanceCents ?? 0 }))
    .sort((a, b) => b.balanceCents - a.balanceCents)[0];

  const pendingCutoff = now.getTime() - PENDING_WINDOW_DAYS * DAY;
  const livePending = rows.filter((r) => r.pending && r.amountCents > 0 && r.postedAt.getTime() >= pendingCutoff);
  const pendingOn = (id: string) => livePending.filter((r) => r.accountId === id).reduce((t, r) => t + r.amountCents, 0);

  const forecasts = acctRows
    .filter((a) => a.subtype === "checking")
    .map((a) =>
      forecastAccount({
        account: { id: a.id, name: a.name, balanceCents: a.balanceCents ?? 0, pendingOutCents: pendingOn(a.id) },
        series,
        cards,
        now,
        horizonDays: HORIZON_DAYS,
        bufferCents: input.bufferCents,
        savings: savings ?? null,
      }),
    )
    .filter((f) => f.events.length > 0 || f.transfer);

  const ignoreKeys = new Set(input.ignoreMerchants.map((m) => merchantKey(m, null)));
  const findings = auditTransactions(rows, { now, recentDays: RECENT_DAYS, ignoreKeys });
  const owed = (reimbursedRows[0]?.fronted ?? 0) - (reimbursedRows[0]?.received ?? 0);
  if (owed > 0) {
    findings.push({
      type: "reimbursement_owed",
      merchant: "Fronted bills",
      date: null,
      cents: owed,
      detail: `Fronted for others in the last ${REIMBURSEMENT_WINDOW_DAYS} days, not yet paid back`,
    });
  }

  // This month's fixed bills: what has landed in the budget month, and what hasn't yet.
  const month = now.toISOString().slice(0, 7);
  const spendSeries = series.filter((s) => s.isSpend && s.direction === "out" && s.status === "active" && s.cadence === "monthly");
  const keyOf = (r: Row) => merchantKey(r.name, r.merchantName);
  const fixedKeys = new Set(spendSeries.map((s) => s.key));
  const landed = rows.filter((r) => !r.pending && r.isSpend && r.budgetMonth === month && fixedKeys.has(keyOf(r)));
  const landedKeys = new Set(landed.map(keyOf));
  const fixedPostedCents = landed.reduce((t, r) => t + r.amountCents, 0);
  const fixedRemainingCents = spendSeries
    .filter((s) => !landedKeys.has(s.key))
    .reduce((t, s) => t + s.typicalCents, 0);
  const pendingCents = livePending.filter((r) => r.isSpend).reduce((t, r) => t + r.amountCents, 0);
  const allPendingCents = livePending.reduce((t, r) => t + r.amountCents, 0);

  return {
    recurring: series.map((s) => ({
      payee: s.key,
      account: s.accountName,
      direction: s.direction,
      cadence: s.cadence,
      typicalUsd: usd(s.typicalCents),
      lastDate: s.lastDate.toISOString().slice(0, 10),
      nextDate: s.status === "active" ? s.nextDate.toISOString().slice(0, 10) : null,
      status: s.status,
      isNew: s.isNew,
      priceChange: s.priceChange ? { fromUsd: usd(s.priceChange.fromCents), toUsd: usd(s.priceChange.toCents) } : null,
    })),
    cashflow: {
      horizonDays: HORIZON_DAYS,
      bufferUsd: usd(input.bufferCents),
      accounts: forecasts.map((f) => ({
        account: f.account,
        startUsd: usd(f.startCents),
        lowestUsd: usd(f.lowestCents),
        lowestDate: f.lowestDate,
        cause: f.cause,
        transferNeeded: f.transfer ? { usd: usd(f.transfer.amountCents), from: f.transfer.from, byDate: f.transfer.byDate } : null,
        events: f.events.map((e) => ({ date: e.date, label: e.label, usd: usd(e.cents), balanceUsd: usd(e.balanceCents) })),
      })),
    },
    audit: findings.map((f) => ({ type: f.type, merchant: f.merchant, date: f.date, usd: usd(f.cents), detail: f.detail })),
    pending: {
      totalUsd: usd(allPendingCents),
      spendingUsd: usd(pendingCents),
      rows: livePending.map((r) => ({
        date: r.postedAt.toISOString().slice(0, 10),
        merchant: merchantKey(r.name, r.merchantName),
        account: r.accountName,
        usd: usd(r.amountCents),
      })),
    },
    monthEnd: {
      fixedPostedUsd: usd(fixedPostedCents),
      fixedStillToComeUsd: usd(fixedRemainingCents),
      projectedUsd: usd(
        projectWithFixedBills({ spentCents: input.monthSpentCents, fixedPostedCents, fixedRemainingCents, now }),
      ),
    },
  };
}
