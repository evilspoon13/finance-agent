import { NextResponse } from "next/server";
import { agentGuard } from "@/lib/agent/guard";
import { parseProfile, PROFILE_KEY } from "@/lib/agent/profile";
import { getContext } from "@/lib/db/agent-queries";
import { heldTickers, listIdeas, listMemos } from "@/lib/db/research-queries";

// GET /api/agent/research/context -> what a web-facing run may know: tickers, the
// watchlist and earlier memos. No balances, amounts or weights: keep it that way.
export async function GET(request: Request) {
  const denied = agentGuard(request, "research");
  if (denied) return denied;
  const [tickers, ideas, memos, raw] = await Promise.all([heldTickers(), listIdeas(), listMemos(5), getContext(PROFILE_KEY)]);
  const { benchmark, excludedTickers, higherBarSectors } = parseProfile(raw).stocks;
  return NextResponse.json({
    asOf: new Date().toISOString(),
    heldTickers: tickers,
    benchmark,
    excludedTickers,
    higherBarSectors,
    ideas,
    recentMemos: memos.map((m) => ({ date: m.createdAt, kind: m.kind, title: m.title, body: m.body })),
  });
}
