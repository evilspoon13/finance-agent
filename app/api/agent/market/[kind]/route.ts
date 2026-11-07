import { NextResponse } from "next/server";
import { agentGuard } from "@/lib/agent/guard";
import { getEarnings, getHistory, getMetrics, getNews, getQuote, MarketNotConfigured, SYMBOL_PATTERN } from "@/lib/agent/market";

const RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y"]);
const DAY = 864e5;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const validDate = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

// GET /api/agent/market/{quote|history|metrics|earnings|news}?symbol=&range=&from=&to=
// Dated market numbers, so research doesn't rest on search snippets. No personal data.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const denied = agentGuard(request, "research");
  if (denied) return denied;
  const { kind } = await ctx.params;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? undefined;
  if (symbol && !SYMBOL_PATTERN.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  const from = validDate(url.searchParams.get("from"), isoDaysAgo(7));
  const to = validDate(url.searchParams.get("to"), isoDaysAgo(0));

  try {
    switch (kind) {
      case "quote": {
        if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
        const quote = await getQuote(symbol);
        return quote ? NextResponse.json(quote) : NextResponse.json({ error: "No quote available" }, { status: 502 });
      }
      case "history": {
        if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
        const range = url.searchParams.get("range") ?? "1y";
        if (!RANGES.has(range)) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
        return NextResponse.json({ symbol, closes: await getHistory(symbol, range) });
      }
      case "metrics":
        if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
        return NextResponse.json(await getMetrics(symbol));
      case "earnings":
        return NextResponse.json(await getEarnings(from, validDate(url.searchParams.get("to"), isoDaysAgo(-14)), symbol));
      case "news":
        return NextResponse.json(await getNews(from, to, symbol));
      default:
        return NextResponse.json({ error: "Unknown market data kind" }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof MarketNotConfigured) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Market data failed" }, { status: 502 });
  }
}
