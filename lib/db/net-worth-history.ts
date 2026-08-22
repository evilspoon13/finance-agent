import { asc, gte } from "drizzle-orm";
import { db } from "./client";
import { netWorthSnapshots } from "./schema";
import { getNetWorth } from "./analytics";

/**
 * Net-worth history: Plaid only reports current balances, so the series is
 * built by snapshotting `getNetWorth()` once per day (see the schema comment on
 * `net_worth_snapshots`). Written by the sync runner and by the Net Worth page
 * on view, both idempotent for the day.
 */

export interface NetWorthPoint {
  day: string; // "YYYY-MM-DD"
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

/** Today as a UTC calendar day, matching the `day` column format. */
function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Record today's net worth. Idempotent: re-running the same day overwrites the
 * row, so the latest sync of the day wins. Returns the point written.
 */
export async function recordNetWorthSnapshot(): Promise<NetWorthPoint> {
  const nw = await getNetWorth();
  const point: NetWorthPoint = {
    day: utcDay(),
    assetsCents: nw.assetsCents,
    liabilitiesCents: nw.liabilitiesCents,
    netWorthCents: nw.netWorthCents,
  };

  await db
    .insert(netWorthSnapshots)
    .values(point)
    .onConflictDoUpdate({
      target: netWorthSnapshots.day,
      set: {
        assetsCents: point.assetsCents,
        liabilitiesCents: point.liabilitiesCents,
        netWorthCents: point.netWorthCents,
        capturedAt: new Date(),
      },
    });

  return point;
}

/** Snapshots for the last `days` calendar days, oldest first. */
export async function getNetWorthHistory(days = 365): Promise<NetWorthPoint[]> {
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: netWorthSnapshots.day,
      assetsCents: netWorthSnapshots.assetsCents,
      liabilitiesCents: netWorthSnapshots.liabilitiesCents,
      netWorthCents: netWorthSnapshots.netWorthCents,
    })
    .from(netWorthSnapshots)
    .where(gte(netWorthSnapshots.day, utcDay(from)))
    .orderBy(asc(netWorthSnapshots.day));

  return rows;
}
