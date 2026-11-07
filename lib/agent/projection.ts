/**
 * Straight-line month-end projection: spend so far scaled by the fraction of
 * the (UTC) month elapsed. Crude by design — rent and other fixed charges land
 * early in the month and inflate it — so the summary reports it alongside the
 * raw figures, and docs/agent.md tells the agent to read it as a pace signal.
 */
export function projectMonthEnd(spentCents: number, now: Date): number {
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.round((spentCents * daysInMonth) / day);
}

/**
 * Month-end estimate that treats fixed bills as fixed: only the variable spend
 * is scaled by the time left, and bills still to come are added at their usual
 * size. Better than the straight line once rent has landed.
 */
export function projectWithFixedBills(input: { spentCents: number; fixedPostedCents: number; fixedRemainingCents: number; now: Date }): number {
  const variable = Math.max(0, input.spentCents - input.fixedPostedCents);
  return projectMonthEnd(variable, input.now) + input.fixedPostedCents + input.fixedRemainingCents;
}
