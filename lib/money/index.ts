/**
 * Money is stored and computed as integer cents everywhere in this app.
 * Never use floats for money. These helpers convert at the edges (parsing
 * Plaid's decimal dollar amounts in / formatting for display out) and do
 * integer-only arithmetic in between.
 */

/** Branded type to make it harder to accidentally mix raw numbers with cents. */
export type Cents = number;

/**
 * Convert a decimal dollar amount (e.g. from Plaid, which returns numbers like
 * 12.34) into integer cents, rounding to the nearest cent to absorb float error.
 */
export function dollarsToCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) {
    throw new Error(`dollarsToCents: non-finite input ${dollars}`);
  }
  return Math.round(dollars * 100);
}

/** Convert integer cents back to a dollar number. For display/formatting only. */
export function centsToDollars(cents: Cents): number {
  assertIntCents(cents);
  return cents / 100;
}

/**
 * Format integer cents as a currency string, e.g. 123456 -> "$1,234.56".
 * Negative values render with a leading minus: -500 -> "-$5.00".
 */
export function formatCents(
  cents: Cents,
  opts: { currency?: string; locale?: string; signDisplay?: "auto" | "always" | "never" } = {},
): string {
  assertIntCents(cents);
  const { currency = "USD", locale = "en-US", signDisplay = "auto" } = opts;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    signDisplay,
  }).format(cents / 100);
}

/** Apply a basis-points rate to a cents amount, returning integer cents (rounded). */
export function applyBps(cents: Cents, bps: number): Cents {
  assertIntCents(cents);
  return Math.round((cents * bps) / 10_000);
}

/** Sum a list of cents values; guards each is an integer. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) {
    assertIntCents(v);
    total += v;
  }
  return total;
}

function assertIntCents(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`Expected integer cents, got ${cents}`);
  }
}
