import { stepDate, type RecurringSeries } from "./recurring";

/**
 * Day-by-day projection of each checking account, to catch a low balance before
 * it happens. Estimates only: card payments come from today's balances and the
 * days they usually get paid, and manual transfers between the user's own
 * accounts aren't predictable, so they're left out (which errs towards warning).
 */

const DAY = 864e5;
const ACH_LEAD_DAYS = 2; // a transfer should start this long before the money is needed
const ROUND_TO_CENTS = 100_00;

export interface CashAccount {
  id: string;
  name: string;
  balanceCents: number;
  pendingOutCents: number;
}

export interface CardPayment {
  issuer: string;
  balanceCents: number;
  payDay: number; // usual day of the month it gets paid
  payerAccountId: string;
}

export interface CashflowEvent {
  date: string;
  label: string;
  cents: number; // positive = money in
  balanceCents: number;
}

export interface AccountForecast {
  account: string;
  startCents: number;
  lowestCents: number;
  lowestDate: string;
  cause: string | null;
  events: CashflowEvent[];
  transfer: { amountCents: number; from: string | null; byDate: string } | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The next time this day of the month comes round, on or after `now`. */
export function nextPayDate(payDay: number, now: Date): Date {
  const at = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(payDay, last)));
  };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const here = at(now.getUTCFullYear(), now.getUTCMonth());
  return here.getTime() >= today ? here : at(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

export function forecastAccount(input: {
  account: CashAccount;
  series: RecurringSeries[];
  cards: CardPayment[];
  now: Date;
  horizonDays: number;
  bufferCents: number;
  savings: { name: string; balanceCents: number } | null;
}): AccountForecast {
  const { account, now, bufferCents } = input;
  const end = now.getTime() + input.horizonDays * DAY;

  const planned: { date: Date; label: string; cents: number }[] = [];
  for (const s of input.series) {
    if (s.accountId !== account.id || s.status !== "active" || s.isCardPayment) continue;
    for (let d = s.nextDate; d.getTime() <= end; d = stepDate(d, s.cadence)) {
      planned.push({ date: d, label: s.key, cents: s.direction === "in" ? s.typicalCents : -s.typicalCents });
    }
  }
  for (const c of input.cards) {
    if (c.payerAccountId !== account.id || c.balanceCents <= 0) continue;
    const date = nextPayDate(c.payDay, now);
    if (date.getTime() <= end) planned.push({ date, label: `${c.issuer} card payment (estimate)`, cents: -c.balanceCents });
  }
  // Money in first on a shared day: a paycheck and a bill on one date shouldn't read as a dip.
  planned.sort((a, b) => a.date.getTime() - b.date.getTime() || b.cents - a.cents);

  const startCents = account.balanceCents - account.pendingOutCents;
  let balance = startCents;
  let lowestCents = startCents;
  let lowestDate = iso(now);
  let cause: string | null = null;
  let firstBelow: Date | null = startCents < bufferCents ? now : null;
  const events = planned.map((e) => {
    balance += e.cents;
    if (balance < lowestCents) {
      lowestCents = balance;
      lowestDate = iso(e.date);
      cause = e.label;
    }
    if (balance < bufferCents) firstBelow ??= e.date;
    return { date: iso(e.date), label: e.label, cents: e.cents, balanceCents: balance };
  });

  // A pass-through account with nothing due doesn't need topping up, however low it sits.
  const shortfall = planned.some((e) => e.cents < 0) || account.pendingOutCents > 0 ? bufferCents - lowestCents : 0;
  const earliest = Math.max(now.getTime(), (firstBelow?.getTime() ?? now.getTime()) - ACH_LEAD_DAYS * DAY);
  return {
    account: account.name,
    startCents,
    lowestCents,
    lowestDate,
    cause,
    events,
    transfer:
      shortfall > 0
        ? {
            amountCents: Math.ceil(shortfall / ROUND_TO_CENTS) * ROUND_TO_CENTS,
            from: input.savings?.name ?? null,
            byDate: iso(new Date(earliest)),
          }
        : null,
  };
}
