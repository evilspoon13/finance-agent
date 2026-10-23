import { sql } from "drizzle-orm";
import { db } from "../client";
import { accounts, holdings, cards } from "../schema";

/**
 * Read-only analytics for the dashboard: net worth, spending breakdowns, and a
 * filterable transaction list. All money is integer cents.
 *
 * Account classification (Plaid `type`):
 *   depository -> cash asset
 *   investment -> investment asset (valued by holdings, falling back to balance)
 *   credit/loan -> liability
 */

export type AccountClass = "cash" | "investment" | "liability" | "other";

export function classify(type: string): AccountClass {
  switch (type) {
    case "depository":
      return "cash";
    case "investment":
    case "brokerage":
      return "investment";
    case "credit":
    case "loan":
      return "liability";
    default:
      return "other";
  }
}

export interface NetWorthLine {
  accountId: string;
  name: string;
  klass: AccountClass;
  valueCents: number; // signed contribution to net worth (assets +, liabilities -)
}

export interface NetWorth {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  lines: NetWorthLine[];
}

export async function getNetWorth(): Promise<NetWorth> {
  const accts = await db.select().from(accounts);

  // Friendly labels for accounts linked to a rewards card.
  const cardRows = await db.select({ accountId: cards.accountId, label: cards.label }).from(cards);
  const labelByAccount = new Map<string, string>();
  for (const r of cardRows) if (r.accountId) labelByAccount.set(r.accountId, r.label);

  // Sum holdings market value per investment account.
  const holdingsByAccount = new Map<string, number>();
  const hRows = await db
    .select({ accountId: holdings.accountId, total: sql<number>`sum(${holdings.valueCents})::int` })
    .from(holdings)
    .groupBy(holdings.accountId);
  for (const r of hRows) holdingsByAccount.set(r.accountId, r.total ?? 0);

  let assets = 0;
  let liabilities = 0;
  const lines: NetWorthLine[] = [];

  for (const a of accts) {
    const klass = classify(a.type);
    const balance = a.currentBalanceCents ?? 0;
    let value = 0;

    if (klass === "cash") {
      value = balance;
      assets += balance;
    } else if (klass === "investment") {
      // Prefer holdings value; fall back to the account balance if none synced.
      value = holdingsByAccount.get(a.id) ?? balance;
      assets += value;
    } else if (klass === "liability") {
      value = -balance; // owed amount reduces net worth
      liabilities += balance;
    } else {
      continue; // ignore unclassified accounts
    }
    lines.push({ accountId: a.id, name: labelByAccount.get(a.id) ?? a.name, klass, valueCents: value });
  }

  lines.sort((x, y) => y.valueCents - x.valueCents);
  return {
    assetsCents: assets,
    liabilitiesCents: liabilities,
    netWorthCents: assets - liabilities,
    lines,
  };
}
