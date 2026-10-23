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
