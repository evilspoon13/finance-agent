import { eq, inArray, desc } from "drizzle-orm";
import { db } from "../client";
import { accounts, holdings, investmentTransactions, items } from "../schema";

/** A single investment position with per-holding gain/loss and allocation. */
export interface PortfolioHolding {
  ticker: string | null;
  name: string;
  account: string;
  quantity: string;
  valueCents: number;
  costBasisCents: number | null;
  gainCents: number | null; // value − cost (null when no cost basis, e.g. cash)
  gainPct: number | null;
  pctOfPortfolio: number; // share of market value (within its account, see getInvestments)
}

// ---------------------------------------------------------------------------
// Investments (detailed, per-account: taxable brokerage / 401k / Roth)
// ---------------------------------------------------------------------------

export type InvestmentKind = "taxable" | "401k" | "roth" | "ira" | "hsa" | "other";

export interface InvestmentActivity {
  id: string;
  postedAt: Date | null;
  type: string; // buy | sell | cash | fee | transfer | cancel
  subtype: string | null;
  ticker: string | null;
  securityName: string | null;
  name: string;
  quantity: string;
  amountCents: number; // positive = cash out (buy), negative = cash in
  priceCents: number | null;
  feesCents: number | null;
}

export interface InvestmentAccount {
  accountId: string;
  name: string;
  institution: string | null;
  subtype: string | null;
  kind: InvestmentKind;
  valueCents: number;
  costCents: number; // summed over holdings with a cost basis
  gainCents: number;
  gainPct: number | null;
  holdings: PortfolioHolding[]; // pctOfPortfolio = share within THIS account
  activity: InvestmentActivity[];
}

export interface Investments {
  totalValueCents: number;
  totalCostCents: number;
  totalGainCents: number;
  totalGainPct: number | null;
  accounts: InvestmentAccount[];
}

/** Map a Plaid investment-account subtype to a coarse kind for grouping/labels. */
export function investmentKind(subtype: string | null): InvestmentKind {
  switch ((subtype ?? "").toLowerCase()) {
    case "brokerage":
    case "non-taxable brokerage account":
    case "cash management":
      return "taxable";
    case "401k":
    case "401a":
    case "403b":
    case "457b":
      return "401k";
    case "roth":
    case "roth 401k":
      return "roth";
    case "ira":
    case "sep ira":
    case "simple ira":
    case "rollover":
      return "ira";
    case "hsa":
      return "hsa";
    default:
      return "other";
  }
}

/**
 * Detailed per-account investment view: each brokerage/retirement account with
 * its holdings (gain/loss + allocation within the account) and recent activity
 * (buys/sells/dividends/fees from investment_transactions), plus overall totals.
 * Value prefers summed holdings market value, falling back to account balance.
 */
export async function getInvestments(): Promise<Investments> {
  const acctRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      subtype: accounts.subtype,
      balanceCents: accounts.currentBalanceCents,
      institution: items.institutionName,
    })
    .from(accounts)
    .innerJoin(items, eq(items.id, accounts.itemId))
    .where(eq(accounts.type, "investment"));

  if (acctRows.length === 0) {
    return { totalValueCents: 0, totalCostCents: 0, totalGainCents: 0, totalGainPct: null, accounts: [] };
  }

  const acctIds = acctRows.map((a) => a.id);

  const hRows = await db
    .select({
      accountId: holdings.accountId,
      ticker: holdings.ticker,
      name: holdings.name,
      quantity: holdings.quantity,
      valueCents: holdings.valueCents,
      costBasisCents: holdings.costBasisCents,
    })
    .from(holdings)
    .where(inArray(holdings.accountId, acctIds))
    .orderBy(desc(holdings.valueCents));

  const aRows = await db
    .select()
    .from(investmentTransactions)
    .where(inArray(investmentTransactions.accountId, acctIds))
    .orderBy(desc(investmentTransactions.postedAt));

  const holdingsByAccount = new Map<string, typeof hRows>();
  for (const h of hRows) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }
  const activityByAccount = new Map<string, InvestmentActivity[]>();
  for (const t of aRows) {
    const list = activityByAccount.get(t.accountId) ?? [];
    list.push({
      id: t.id,
      postedAt: t.postedAt,
      type: t.type,
      subtype: t.subtype,
      ticker: t.ticker,
      securityName: t.securityName,
      name: t.name,
      quantity: t.quantity,
      amountCents: t.amountCents,
      priceCents: t.priceCents,
      feesCents: t.feesCents,
    });
    activityByAccount.set(t.accountId, list);
  }

  const outAccounts: InvestmentAccount[] = acctRows.map((a) => {
    const hs = holdingsByAccount.get(a.id) ?? [];
    const holdingsValue = hs.reduce((s, h) => s + h.valueCents, 0);
    // Prefer holdings market value; fall back to the account balance if none synced.
    const valueCents = hs.length > 0 ? holdingsValue : a.balanceCents ?? 0;

    let costWithBasis = 0;
    let valueWithBasis = 0;
    for (const h of hs) {
      if (h.costBasisCents != null) {
        costWithBasis += h.costBasisCents;
        valueWithBasis += h.valueCents;
      }
    }
    const gainCents = valueWithBasis - costWithBasis;

    const holdingList: PortfolioHolding[] = hs.map((h) => {
      const g = h.costBasisCents != null ? h.valueCents - h.costBasisCents : null;
      const gPct = h.costBasisCents && h.costBasisCents > 0 ? ((h.valueCents - h.costBasisCents) / h.costBasisCents) * 100 : null;
      return {
        ticker: h.ticker,
        name: h.name,
        account: a.name,
        quantity: h.quantity,
        valueCents: h.valueCents,
        costBasisCents: h.costBasisCents,
        gainCents: g,
        gainPct: gPct,
        pctOfPortfolio: holdingsValue > 0 ? (h.valueCents / holdingsValue) * 100 : 0,
      };
    });

    return {
      accountId: a.id,
      name: a.name,
      institution: a.institution,
      subtype: a.subtype,
      kind: investmentKind(a.subtype),
      valueCents,
      costCents: costWithBasis,
      gainCents,
      gainPct: costWithBasis > 0 ? (gainCents / costWithBasis) * 100 : null,
      holdings: holdingList,
      activity: activityByAccount.get(a.id) ?? [],
    };
  });

  outAccounts.sort((x, y) => y.valueCents - x.valueCents);

  const totalValue = outAccounts.reduce((s, a) => s + a.valueCents, 0);
  const totalCost = outAccounts.reduce((s, a) => s + a.costCents, 0);
  const totalGain = outAccounts.reduce((s, a) => s + a.gainCents, 0);

  return {
    totalValueCents: totalValue,
    totalCostCents: totalCost,
    totalGainCents: totalGain,
    totalGainPct: totalCost > 0 ? (totalGain / totalCost) * 100 : null,
    accounts: outAccounts,
  };
}
