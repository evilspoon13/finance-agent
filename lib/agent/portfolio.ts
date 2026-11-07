import type { Profile } from "./profile";

/**
 * Portfolio view and the hard limits on proposals. The limits live here, not in
 * the prompt: POST /api/agent/proposals refuses anything that breaks them.
 */

type StockRules = Profile["stocks"];

export interface Position {
  ticker: string | null;
  accountKind: string;
  valueCents: number;
  costBasisCents: number | null;
}

export interface RecentBuy {
  ticker: string;
  date: string;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const isCash = (ticker: string | null) => ticker?.startsWith("CUR:") ?? false;

/** Funds and unnamed holdings are core; any other ticker is an individual position. */
const isCore = (ticker: string | null, rules: StockRules) => ticker === null || rules.coreTickers.includes(ticker);

export function portfolioView(positions: Position[], rules: StockRules) {
  const invested = positions.filter((p) => !isCash(p.ticker));
  const totalCents = invested.reduce((t, p) => t + p.valueCents, 0);
  const byTicker = new Map<string, number>();
  for (const p of invested) byTicker.set(p.ticker ?? "(unnamed)", (byTicker.get(p.ticker ?? "(unnamed)") ?? 0) + p.valueCents);
  const tickers = [...byTicker.entries()]
    .map(([ticker, valueCents]) => ({
      ticker,
      valueCents,
      pct: pct(valueCents, totalCents),
      core: ticker === "(unnamed)" || isCore(ticker, rules),
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
  const sleeveCents = tickers.filter((t) => !t.core).reduce((sum, t) => sum + t.valueCents, 0);
  return {
    totalCents,
    tickers,
    sleeveCents,
    sleevePct: pct(sleeveCents, totalCents),
    // New money grows the total too, so room = the buy that lands exactly on the cap.
    sleeveRoomCents: Math.max(0, Math.floor((rules.sleevePct * totalCents - 100 * sleeveCents) / (100 - rules.sleevePct))),
    perNameMaxCents: Math.floor((rules.perNamePct * totalCents) / (100 - rules.perNamePct)),
  };
}

export type PortfolioView = ReturnType<typeof portfolioView>;

/** Taxable positions at a loss bought again within 30 days: selling now would be a wash sale. */
export function washSaleRisks(positions: Position[], recentBuys: RecentBuy[]): string[] {
  const bought = new Set(recentBuys.map((b) => b.ticker));
  const atLoss = positions.filter(
    (p) => p.accountKind === "taxable" && p.ticker && p.costBasisCents !== null && p.valueCents < p.costBasisCents,
  );
  return [...new Set(atLoss.filter((p) => bought.has(p.ticker!)).map((p) => p.ticker!))];
}

export interface ProposalInput {
  ticker: string;
  action: "buy" | "sell" | "hold";
  amountCents: number;
  fundedBy?: "new_money" | "selling_core" | "existing_cash";
  sector?: string;
  sectorJustification?: string;
}

export function checkProposal(p: ProposalInput, view: PortfolioView, rules: StockRules, washRisks: string[]) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (p.action === "sell" && washRisks.includes(p.ticker)) {
    warnings.push(`${p.ticker} was bought in the last 30 days: selling it at a loss now would be a wash sale`);
  }
  if (p.action !== "buy") return { errors, warnings };

  if (rules.excludedTickers.includes(p.ticker)) errors.push(`${p.ticker} is excluded from buy proposals`);
  if (washRisks.includes(p.ticker)) warnings.push(`${p.ticker} is held at a taxable loss: buying more blocks harvesting that loss for 30 days`);
  if (isCore(p.ticker, rules)) return { errors, warnings };

  if (p.fundedBy !== "new_money") errors.push("Individual stocks must be funded with new money, never by selling core funds");

  const held = view.tickers.find((t) => t.ticker === p.ticker)?.valueCents ?? 0;
  const after = view.totalCents + p.amountCents;
  const namePct = pct(held + p.amountCents, after);
  const sleeveAfter = pct(view.sleeveCents + p.amountCents, after);
  if (namePct > rules.perNamePct) errors.push(`${p.ticker} would be ${namePct}% of investable assets, over the ${rules.perNamePct}% limit (max buy now $${Math.max(0, view.perNameMaxCents - held) / 100})`);
  if (sleeveAfter > rules.sleevePct) errors.push(`Individual stocks would be ${sleeveAfter}%, over the ${rules.sleevePct}% limit (room $${view.sleeveRoomCents / 100})`);

  if (p.sector && rules.higherBarSectors.includes(p.sector) && !p.sectorJustification?.trim()) {
    errors.push(`${p.sector} needs a sectorJustification: pay and existing funds are already exposed to it`);
  }
  return { errors, warnings };
}

/** A proposal's result against the benchmark since it was made. Null until both prices are known. */
export function scoreProposal(p: { entryCents: number | null; benchEntryCents: number | null; nowCents: number | null; benchNowCents: number | null }) {
  if (!p.entryCents || !p.benchEntryCents || !p.nowCents || !p.benchNowCents) return null;
  const change = (now: number, then: number) => Math.round((now / then - 1) * 1000) / 10;
  const returnPct = change(p.nowCents, p.entryCents);
  const benchmarkPct = change(p.benchNowCents, p.benchEntryCents);
  return { returnPct, benchmarkPct, excessPct: Math.round((returnPct - benchmarkPct) * 10) / 10 };
}
