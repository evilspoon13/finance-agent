/**
 * IRS contribution limits by tax year, for contribution pacing in the agent
 * summary. Add a year when the IRS announces it (usually each November); a year
 * that's missing is reported as unknown rather than guessed.
 */
export const CONTRIBUTION_LIMITS: Record<number, { employee401k: number; ira: number; hsaSelf: number; hsaFamily: number }> = {
  2026: { employee401k: 24_500, ira: 7_500, hsaSelf: 4_400, hsaFamily: 8_750 },
};
