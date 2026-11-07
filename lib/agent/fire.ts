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

/**
 * Pay events grouped into paychecks: deposits within a few days of each other are
 * one check split across accounts. Returns each check's total, oldest first.
 */
export function groupPaychecks(deposits: { date: Date; cents: number }[], windowDays = 3): number[] {
  const sorted = [...deposits].sort((a, b) => a.date.getTime() - b.date.getTime());
  const checks: { last: number; cents: number }[] = [];
  for (const d of sorted) {
    const current = checks.at(-1);
    if (current && d.date.getTime() - current.last <= windowDays * 864e5) {
      current.cents += d.cents;
      current.last = d.date.getTime();
    } else {
      checks.push({ last: d.date.getTime(), cents: d.cents });
    }
  }
  return checks.map((c) => c.cents);
}

/**
 * Savings rate on gross pay: what was saved, plus payroll HSA the bank never
 * sees, over gross pay plus other income. Null without gross pay or any checks.
 */
export function grossSavingsRatePct(input: {
  savedCents: number;
  otherIncomeCents: number;
  checks: number;
  grossPerCheckCents: number;
  hsaPerCheckCents: number;
}): number | null {
  const gross = input.grossPerCheckCents * input.checks + input.otherIncomeCents;
  if (gross <= 0 || input.checks <= 0) return null;
  return Math.round(((input.savedCents + input.hsaPerCheckCents * input.checks) / gross) * 1000) / 10;
}

/** A year at the usual paycheck: removes the noise of 3-check months and one-off pay. */
export function normalizedYear(input: {
  netPerCheckCents: number;
  retirementPerCheckCents: number;
  hsaPerCheckCents: number;
  checksPerYear: number;
  annualSpendCents: number;
  plannedExtrasCents: number; // net RSU and bonus money, which isn't in a usual paycheck
}) {
  const payCents = (input.netPerCheckCents + input.retirementPerCheckCents + input.hsaPerCheckCents) * input.checksPerYear;
  const incomeCents = payCents + input.plannedExtrasCents;
  const annualSavingsCents = incomeCents - input.annualSpendCents;
  return {
    incomeCents,
    annualSavingsCents,
    annualSavingsWithoutExtrasCents: payCents - input.annualSpendCents,
    savingsRatePct: incomeCents > 0 ? Math.round((annualSavingsCents / incomeCents) * 1000) / 10 : null,
  };
}

const roundYears = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** How much each lever moves the FI date, so advice can be ranked by impact. */
export function fiScenarios(input: {
  investedCents: number;
  annualSavingsCents: number;
  annualSpendCents: number;
  extrasCents: number;
  age?: number;
  retirementAge?: number;
}) {
  const { investedCents: p, annualSavingsCents: s, annualSpendCents: spend, extrasCents } = input;
  const target = spend * FI_MULTIPLE;
  const baseYears = yearsToTarget(p, s, target);
  const lever = (label: string, years: number | null) => ({
    label,
    years: roundYears(years),
    yearsSaved: years === null || baseYears === null ? null : roundYears(baseYears - years),
  });
  const trim = 100_00 * 12;
  const extra = 200_00 * 12;
  const yearsLeft = input.age && input.retirementAge ? input.retirementAge - input.age : null;
  const coastCents = yearsLeft && yearsLeft > 0 ? Math.round(target / (1 + REAL_RETURN) ** yearsLeft) : null;
  return {
    baseYears: roundYears(baseYears),
    levers: [
      lever("Spend $100/mo less, now and in retirement", yearsToTarget(p, s + trim, target - trim * FI_MULTIPLE)),
      lever("Save $200/mo more", yearsToTarget(p, s + extra, target)),
      lever("RSU and bonus money not invested", yearsToTarget(p, s - extrasCents, target)),
    ],
    byRealReturn: [0.03, 0.05, 0.07].map((r) => ({ realReturn: r, years: roundYears(yearsToTarget(p, s, target, r)) })),
    coastFi: coastCents === null ? null : { neededTodayCents: coastCents, reached: p >= coastCents, atAge: input.retirementAge },
  };
}
