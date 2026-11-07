import { median, merchantKey } from "./recurring";

/**
 * Rule-based checks over recent transactions. These find candidates; the agent
 * decides which ones matter and explains them. Pure, so each rule is testable.
 */

const DAY = 864e5;
const DUPLICATE_WINDOW_DAYS = 3;
const STALE_PENDING_DAYS = 7;
const SPIKE_MULTIPLE = 2;
const SPIKE_MIN_CENTS = 25_00;
const FIRST_TIME_MIN_CENTS = 100_00;
const CATEGORY_MULTIPLE = 1.5;
const CATEGORY_MIN_CENTS = 100_00;
const FEE_PATTERN = /overdraft|\bnsf\b|late (payment )?fee|interest charge|foreign transaction|annual fee|returned item|service charge/i;

export interface AuditRow {
  accountName: string;
  name: string;
  merchantName: string | null;
  amountCents: number;
  postedAt: Date;
  pending: boolean;
  pfcPrimary: string | null;
  isSpend: boolean;
}

export type FindingType =
  | "duplicate"
  | "fee"
  | "amount_spike"
  | "first_time_large"
  | "stale_pending"
  | "category_spike"
  | "reimbursement_owed";

export interface Finding {
  type: FindingType;
  merchant: string;
  date: string | null;
  cents: number;
  detail: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export function auditTransactions(rows: AuditRow[], opts: { now: Date; recentDays: number; ignoreKeys: Set<string> }): Finding[] {
  const { now, recentDays, ignoreKeys } = opts;
  const since = now.getTime() - recentDays * DAY;
  const keyed = rows
    .map((r) => ({ ...r, key: merchantKey(r.name, r.merchantName) }))
    .filter((r) => !ignoreKeys.has(r.key))
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const isRecent = (r: { postedAt: Date }) => r.postedAt.getTime() >= since;
  const settled = keyed.filter((r) => !r.pending);
  const findings: Finding[] = [];

  // Same charge twice on one account within a few days.
  const spend = settled.filter((r) => r.isSpend && r.amountCents > 0);
  spend.forEach((r, i) => {
    const twin = spend
      .slice(0, i)
      .find(
        (p) =>
          p.key === r.key &&
          p.amountCents === r.amountCents &&
          p.accountName === r.accountName &&
          r.postedAt.getTime() - p.postedAt.getTime() <= DUPLICATE_WINDOW_DAYS * DAY,
      );
    if (twin && isRecent(r)) {
      findings.push({
        type: "duplicate",
        merchant: r.key,
        date: iso(r.postedAt),
        cents: r.amountCents,
        detail: `Same amount on ${iso(twin.postedAt)} and ${iso(r.postedAt)} (${r.accountName})`,
      });
    }
  });

  for (const r of settled) {
    if (!isRecent(r) || r.amountCents <= 0) continue;
    if (r.pfcPrimary === "BANK_FEES" || FEE_PATTERN.test(r.name)) {
      findings.push({ type: "fee", merchant: r.key, date: iso(r.postedAt), cents: r.amountCents, detail: `Fee on ${r.accountName}` });
    }
  }

  // Well above what this merchant usually charges, or a big first-time charge.
  for (const r of spend) {
    if (!isRecent(r)) continue;
    const earlier = spend.filter((p) => p.key === r.key && p.postedAt.getTime() < r.postedAt.getTime());
    if (earlier.length === 0 && r.amountCents >= FIRST_TIME_MIN_CENTS) {
      findings.push({ type: "first_time_large", merchant: r.key, date: iso(r.postedAt), cents: r.amountCents, detail: "First charge from this merchant" });
    } else if (earlier.length >= 3) {
      const usual = median(earlier.map((p) => p.amountCents));
      // Shops like Amazon vary a lot: only a new high counts as a spike.
      const highest = Math.max(...earlier.map((p) => p.amountCents));
      if (r.amountCents >= usual * SPIKE_MULTIPLE && r.amountCents - usual >= SPIKE_MIN_CENTS && r.amountCents > highest) {
        findings.push({ type: "amount_spike", merchant: r.key, date: iso(r.postedAt), cents: r.amountCents, detail: `Usually about ${dollars(usual)}` });
      }
    }
  }

  // A pending row this old has usually been replaced and left behind. One line
  // for all of them: they're a data problem, not several things to investigate.
  const stale = keyed.filter((r) => r.pending && now.getTime() - r.postedAt.getTime() > STALE_PENDING_DAYS * DAY);
  if (stale.length) {
    findings.push({
      type: "stale_pending",
      merchant: `${stale.length} old pending row${stale.length > 1 ? "s" : ""}`,
      date: iso(stale[0]!.postedAt),
      cents: stale.reduce((t, r) => t + r.amountCents, 0),
      detail: `Not counted anywhere: ${[...new Set(stale.map((r) => r.key))].slice(0, 5).join(", ")}`,
    });
  }
  return findings;
}

/** Categories running well above their recent average this month. */
export function categorySpikes(thisMonth: Record<string, number>, pastMonths: Record<string, number>[]): Finding[] {
  if (!pastMonths.length) return [];
  return Object.entries(thisMonth).flatMap(([category, cents]) => {
    const average = pastMonths.reduce((t, m) => t + (m[category] ?? 0), 0) / pastMonths.length;
    if (cents < average * CATEGORY_MULTIPLE || cents - average < CATEGORY_MIN_CENTS) return [];
    return [{ type: "category_spike" as const, merchant: category, date: null, cents, detail: `Recent average ${dollars(Math.round(average))}/mo` }];
  });
}
