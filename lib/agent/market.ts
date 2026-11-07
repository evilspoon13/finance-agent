import { env } from "@/lib/env";

/**
 * Market data for the agent. Prices come from Finnhub when FINNHUB_API_KEY is
 * set, else Yahoo's unofficial chart endpoint (no key; it can change or block
 * without notice, so a failure returns null rather than throwing). Fundamentals,
 * earnings and news need Finnhub. Results are cached briefly: a run asks for the
 * same tickers repeatedly and free tiers are rate limited.
 */

const CACHE_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;
const cache = new Map<string, { at: number; value: unknown }>();

export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export class MarketNotConfigured extends Error {}

export interface Quote {
  symbol: string;
  priceCents: number;
  previousCloseCents: number | null;
  changePct: number | null;
  source: "finnhub" | "yahoo";
  asOf: string;
}

const cents = (usd: number) => Math.round(usd * 100);

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  const value = await res.json();
  cache.set(url, { at: Date.now(), value });
  return value;
}

const finnhub = (path: string) => {
  const key = env().FINNHUB_API_KEY;
  if (!key) throw new MarketNotConfigured("Set FINNHUB_API_KEY for fundamentals, earnings and news");
  return getJson(`https://finnhub.io/api/v1${path}`, { "X-Finnhub-Token": key });
};

interface YahooChart {
  chart?: {
    result?: {
      meta: { regularMarketPrice?: number; chartPreviousClose?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

const yahoo = (symbol: string, range: string) =>
  getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, {
    "User-Agent": "Mozilla/5.0",
  }) as Promise<YahooChart>;

async function yahooQuote(symbol: string): Promise<Quote | null> {
  const meta = (await yahoo(symbol, "5d")).chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const previous = meta.chartPreviousClose ?? null;
  return {
    symbol,
    priceCents: cents(meta.regularMarketPrice),
    previousCloseCents: previous === null ? null : cents(previous),
    changePct: previous ? Math.round((meta.regularMarketPrice / previous - 1) * 10000) / 100 : null,
    source: "yahoo",
    asOf: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

async function finnhubQuote(symbol: string): Promise<Quote | null> {
  const q = (await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`)) as { c?: number; pc?: number; dp?: number; t?: number };
  if (!q.c) return null;
  return {
    symbol,
    priceCents: cents(q.c),
    previousCloseCents: q.pc ? cents(q.pc) : null,
    changePct: q.dp ?? null,
    source: "finnhub",
    asOf: new Date((q.t ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

/** The latest price from whichever source answers; null if neither does. */
export async function getQuote(symbol: string): Promise<Quote | null> {
  if (env().FINNHUB_API_KEY) {
    const quote = await finnhubQuote(symbol).catch(() => null);
    if (quote) return quote;
  }
  return yahooQuote(symbol).catch(() => null);
}

/** Daily closes, for returns and drawdowns. */
export async function getHistory(symbol: string, range: string) {
  const r = (await yahoo(symbol, range)).chart?.result?.[0];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  return (r?.timestamp ?? []).flatMap((t, i) => {
    const close = closes[i];
    return close == null ? [] : [{ day: new Date(t * 1000).toISOString().slice(0, 10), close }];
  });
}

export const getMetrics = (symbol: string) => finnhub(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
export const getEarnings = (from: string, to: string, symbol?: string) =>
  finnhub(`/calendar/earnings?from=${from}&to=${to}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`);
export const getNews = (from: string, to: string, symbol?: string) =>
  finnhub(symbol ? `/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}` : "/news?category=general");
