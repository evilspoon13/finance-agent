import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getQuote } from "@/lib/agent/market";
import { db } from "./client";
import { holdings, investmentIdeas, investmentProposals, priceSnapshots, researchMemos, type InvestmentProposal } from "./schema";

/** Market research, the watchlist, proposals and daily prices. See docs/research.md. */

const TRADABLE = sql`${holdings.ticker} is not null and ${holdings.ticker} not like 'CUR:%' and ${holdings.ticker} !~ '\\.[A-Z]+\\.'`;

/** Held tickers with nothing about how much: all a web-facing run gets to see. */
export async function heldTickers(): Promise<string[]> {
  const rows = await db.selectDistinct({ ticker: holdings.ticker }).from(holdings).where(TRADABLE);
  return rows.flatMap((r) => (r.ticker ? [r.ticker] : [])).sort();
}

export async function listIdeas() {
  return db.select().from(investmentIdeas).orderBy(desc(investmentIdeas.updatedAt));
}

export async function upsertIdea(input: {
  ticker: string;
  name?: string;
  status: string;
  thesis?: string;
  bearCase?: string;
  valuation?: string;
  invalidation?: string;
  nextReviewOn?: string;
}) {
  const { ticker, ...fields } = input;
  await db
    .insert(investmentIdeas)
    .values(input)
    .onConflictDoUpdate({ target: investmentIdeas.ticker, set: { ...fields, updatedAt: new Date() } });
  return ticker;
}

export async function listMemos(limit = 30, kinds?: string[]) {
  return db
    .select()
    .from(researchMemos)
    .where(kinds ? inArray(researchMemos.kind, kinds) : undefined)
    .orderBy(desc(researchMemos.createdAt))
    .limit(limit);
}

export async function createMemo(input: {
  kind: string;
  title: string;
  body: string;
  sources: { title: string; url: string; date?: string }[];
  sessionUrl?: string;
}) {
  const id = randomUUID();
  await db.insert(researchMemos).values({ id, ...input });
  return id;
}

export async function listProposals(limit = 50): Promise<InvestmentProposal[]> {
  return db.select().from(investmentProposals).orderBy(desc(investmentProposals.createdAt)).limit(limit);
}

export async function createProposal(input: {
  ticker: string;
  action: string;
  account: string;
  amountCents: number;
  rationale: string;
  entryCondition?: string;
  invalidation?: string;
  reviewOn?: string;
  benchmarkTicker: string;
}) {
  const [entry, benchmark] = await Promise.all([getQuote(input.ticker), getQuote(input.benchmarkTicker)]);
  const id = randomUUID();
  await db.insert(investmentProposals).values({
    id,
    ...input,
    entryPriceCents: entry?.priceCents ?? null,
    benchmarkPriceCents: benchmark?.priceCents ?? null,
  });
  await db
    .update(investmentIdeas)
    .set({ status: "proposed", updatedAt: new Date() })
    .where(and(eq(investmentIdeas.ticker, input.ticker), inArray(investmentIdeas.status, ["researching", "watch"])));
  return { id, pricesRecorded: Boolean(entry && benchmark) };
}

/** The user's decision. A proposal accepted for a stock moves its idea to "owned". */
export async function decideProposal(id: string, status: "accepted" | "declined", note?: string) {
  const [row] = await db
    .update(investmentProposals)
    .set({ status, decisionNote: note ?? null, decidedAt: new Date() })
    .where(eq(investmentProposals.id, id))
    .returning({ ticker: investmentProposals.ticker, action: investmentProposals.action });
  if (row && status === "accepted" && row.action === "buy") {
    await db.update(investmentIdeas).set({ status: "owned", updatedAt: new Date() }).where(eq(investmentIdeas.ticker, row.ticker));
  }
}

/** Latest stored close per ticker, for scoring proposals without a network call. */
export async function latestPrices(tickers: string[]): Promise<Map<string, number>> {
  if (!tickers.length) return new Map();
  const rows = await db
    .selectDistinctOn([priceSnapshots.ticker], { ticker: priceSnapshots.ticker, closeCents: priceSnapshots.closeCents })
    .from(priceSnapshots)
    .where(inArray(priceSnapshots.ticker, tickers))
    .orderBy(priceSnapshots.ticker, desc(priceSnapshots.day));
  return new Map(rows.map((r) => [r.ticker, r.closeCents]));
}

/** Record today's price for everything held, watched or proposed. Runs with the daily sync. */
export async function recordDailyPrices(benchmark: string): Promise<number> {
  const [held, ideas, proposals] = await Promise.all([
    heldTickers(),
    db.select({ ticker: investmentIdeas.ticker }).from(investmentIdeas),
    db.selectDistinct({ ticker: investmentProposals.ticker }).from(investmentProposals),
  ]);
  const tickers = [...new Set([benchmark, ...held, ...ideas.map((i) => i.ticker), ...proposals.map((p) => p.ticker)])];
  const quotes = await Promise.all(tickers.map((t) => getQuote(t)));
  const rows = quotes.flatMap((q) => (q ? [{ ticker: q.symbol, day: q.asOf.slice(0, 10), closeCents: q.priceCents }] : []));
  if (!rows.length) return 0;
  await db
    .insert(priceSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [priceSnapshots.ticker, priceSnapshots.day],
      set: { closeCents: sql`excluded.close_cents` },
    });
  return rows.length;
}
