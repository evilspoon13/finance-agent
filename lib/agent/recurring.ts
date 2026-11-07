/**
 * Finds repeating money movements from transaction history: rent, subscriptions,
 * paychecks, scheduled transfers. Pure, so it's testable and can be replayed on
 * past dates. Needs three occurrences, so a brand-new bill shows up on its third.
 */

const DAY = 864e5;

export interface FlowRow {
  accountId: string;
  accountName: string;
  isCard: boolean;
  name: string;
  merchantName: string | null;
  amountCents: number; // positive = out
  postedAt: Date;
  pending: boolean;
  pfcDetailed: string | null;
  isSpend: boolean;
}

export type Cadence = "weekly" | "biweekly" | "monthly";

export interface RecurringSeries {
  key: string;
  accountId: string;
  accountName: string;
  direction: "in" | "out";
  cadence: Cadence;
  typicalCents: number; // always positive
  lastCents: number;
  lastDate: Date;
  nextDate: Date;
  count: number;
  status: "active" | "stopped";
  isNew: boolean;
  isCardPayment: boolean;
  isIncome: boolean;
  isSpend: boolean;
  priceChange: { fromCents: number; toCents: number } | null;
}

export const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const RECENT_EVENTS = 5; // judge the current pattern, not an older one that has ended
const SIDE_PAYMENT_SHARE = 0.5; // a one-off fee next to a bill shouldn't break its rhythm
const CADENCES: { cadence: Cadence; min: number; max: number; slack: number; days: number }[] = [
  { cadence: "weekly", min: 6, max: 8, slack: 2, days: 7 },
  { cadence: "biweekly", min: 12, max: 16, slack: 3, days: 14 },
  { cadence: "monthly", min: 26, max: 35, slack: 6, days: 30 },
];

/** A stable name for a payee: bank descriptions embed trace IDs that differ on every row. */
export function merchantKey(name: string, merchantName: string | null): string {
  // Bank descriptions are stable where Plaid's merchant name can change mid-stream.
  return (/\bTYPE:/.test(name) ? name : merchantName || name)
    .toUpperCase()
    .replace(/\s+(TYPE|ID|ACH|DES|INDN|TRACE|CO|NAME):?\s.*$/, "")
    .replace(/^(TST\*|SQ \*|CL \*|PAYPAL \*|PY \*)\s*/, "")
    .replace(/#?\b\d{3,}\b/g, " ")
    .replace(/[^A-Z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The next occurrence after `from`. Monthly keeps the day of the month, clamped to short months. */
export function stepDate(from: Date, cadence: Cadence): Date {
  if (cadence === "weekly") return new Date(from.getTime() + 7 * DAY);
  if (cadence === "biweekly") return new Date(from.getTime() + 14 * DAY);
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(from.getUTCDate(), last)));
}

function classify(gaps: number[]) {
  const mid = median(gaps);
  const match = CADENCES.find((c) => mid >= c.min && mid <= c.max);
  if (!match) return null;
  const regular = gaps.filter((g) => Math.abs(g - match.days) <= match.slack).length;
  return regular / gaps.length >= 0.6 ? match : null;
}

const CARDS = "cards";

export function detectRecurring(rows: FlowRow[], now: Date): RecurringSeries[] {
  const groups = new Map<string, FlowRow[]>();
  for (const r of rows) {
    if (r.pending || r.amountCents === 0) continue;
    // Bank flows belong to their account. A bill can move between cards and stay one bill.
    const id = `${r.isCard ? CARDS : r.accountId}|${merchantKey(r.name, r.merchantName)}|${r.amountCents > 0 ? "out" : "in"}`;
    const list = groups.get(id);
    if (list) list.push(r);
    else groups.set(id, [r]);
  }

  const series: RecurringSeries[] = [];
  for (const [id, list] of groups) {
    // Several rows on one day are one event (a bill split across payments).
    const byDay = new Map<string, { date: Date; cents: number }>();
    for (const r of list) {
      const day = dayOf(r.postedAt);
      const e = byDay.get(day);
      if (e) e.cents += Math.abs(r.amountCents);
      else byDay.set(day, { date: r.postedAt, cents: Math.abs(r.amountCents) });
    }
    const all = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
    const typical = median(all.slice(-RECENT_EVENTS).map((e) => e.cents));
    const events = all.filter((e) => e.cents >= typical * SIDE_PAYMENT_SHARE).slice(-RECENT_EVENTS);
    if (events.length < 3) continue;

    const gaps = events.slice(1).map((e, i) => Math.round((e.date.getTime() - events[i]!.date.getTime()) / DAY));
    const match = classify(gaps);
    if (!match) continue;

    const isIncome = list.some((r) => r.pfcDetailed === "INCOME_SALARY");
    const amounts = events.map((e) => e.cents);
    const mid = median(amounts);
    // Paychecks move with deductions; anything else must hold a steady amount.
    if (!isIncome && amounts.filter((a) => Math.abs(a - mid) <= mid * 0.25).length / amounts.length < 0.6) continue;

    const last = events.at(-1)!;
    const prior = median(amounts.slice(0, -1));
    const changed = Math.abs(last.cents - prior) >= 100 && Math.abs(last.cents - prior) >= prior * 0.05;
    let nextDate = stepDate(last.date, match.cadence);
    const stopped = now.getTime() - last.date.getTime() > match.days * 1.6 * DAY;
    while (!stopped && nextDate.getTime() < now.getTime() - DAY) nextDate = stepDate(nextDate, match.cadence);

    const [accountId, key, direction] = id.split("|") as [string, string, "in" | "out"];
    series.push({
      key,
      accountId,
      accountName: accountId === CARDS ? "Credit cards" : list[0]!.accountName,
      direction,
      cadence: match.cadence,
      typicalCents: median(amounts.slice(-3)),
      lastCents: last.cents,
      lastDate: last.date,
      nextDate,
      count: all.length,
      status: stopped ? "stopped" : "active",
      isNew: all.length === 3,
      isCardPayment: list.some((r) => r.pfcDetailed === CARD_PAYMENT),
      isIncome,
      isSpend: list.some((r) => r.isSpend),
      priceChange: changed && !isIncome ? { fromCents: prior, toCents: last.cents } : null,
    });
  }
  return series.sort((a, b) => b.typicalCents - a.typicalCents);
}
