/**
 * Financial-independence math for the agent summary. Pure, so it's testable and
 * the agent can reproduce it (docs/agent.md gives the same formulas).
 */

/** The "4% rule": the portfolio that sustains `annualSpending` indefinitely. */
export const FI_MULTIPLE = 25;

/** Real (after-inflation) annual return assumed for projections. */
export const REAL_RETURN = 0.05;

/**
 * Years until `start` grows to `target` with `annualSavings` added each year at
 * `realReturn`: solves start·(1+r)^n + s·((1+r)^n − 1)/r = target for n.
 * 0 when already there; null when it never gets there (nothing invested or saved).
 */
export function yearsToTarget(start: number, annualSavings: number, target: number, realReturn = REAL_RETURN): number | null {
  if (start >= target) return 0;
  if (realReturn === 0) return annualSavings > 0 ? (target - start) / annualSavings : null;
  const k = annualSavings / realReturn;
  if (start + k <= 0) return null;
  const n = Math.log((target + k) / (start + k)) / Math.log(1 + realReturn);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Share of income kept (not spent), as a percentage with one decimal; null without income. */
export function savingsRatePct(incomeCents: number, spentCents: number): number | null {
  if (incomeCents <= 0) return null;
  return Math.round(((incomeCents - spentCents) / incomeCents) * 1000) / 10;
}
