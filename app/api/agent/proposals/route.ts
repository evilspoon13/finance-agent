import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { SYMBOL_PATTERN } from "@/lib/agent/market";
import { checkProposal, portfolioView, positionsOf, recentBuysOf, washSaleRisks } from "@/lib/agent/portfolio";
import { parseProfile, PROFILE_KEY } from "@/lib/agent/profile";
import { getContext } from "@/lib/db/agent-queries";
import { getInvestments } from "@/lib/db/analytics";
import { createProposal } from "@/lib/db/research-queries";

const bodySchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(SYMBOL_PATTERN),
  action: z.enum(["buy", "sell", "hold"]),
  account: z.string().trim().min(1).max(100),
  amountUsd: z.number().nonnegative().max(10_000_000),
  rationale: z.string().trim().min(1).max(6_000),
  fundedBy: z.enum(["new_money", "selling_core", "existing_cash"]).optional(),
  sector: z.string().trim().max(60).optional(),
  sectorJustification: z.string().trim().max(2_000).optional(),
  entryCondition: z.string().trim().max(1_000).optional(),
  invalidation: z.string().trim().max(1_000).optional(),
  reviewOn: z.iso.date().optional(),
});

// POST /api/agent/proposals -> record one proposal. Refused with 422 when it breaks
// the limits in the profile; prices are recorded here so it can be scored later.
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid proposal", issues: parsed.error.issues }, { status: 400 });
  }
  const p = parsed.data;
  const amountCents = Math.round(p.amountUsd * 100);

  const [raw, investments] = await Promise.all([getContext(PROFILE_KEY), getInvestments()]);
  const rules = parseProfile(raw).stocks;
  const positions = positionsOf(investments.accounts);
  const buys = recentBuysOf(investments.accounts, new Date());
  const { errors, warnings } = checkProposal({ ...p, amountCents }, portfolioView(positions, rules), rules, washSaleRisks(positions, buys));
  if (errors.length) return NextResponse.json({ ok: false, errors, warnings }, { status: 422 });

  const created = await createProposal({
    ticker: p.ticker,
    action: p.action,
    account: p.account,
    amountCents,
    rationale: p.rationale,
    entryCondition: p.entryCondition,
    invalidation: p.invalidation,
    reviewOn: p.reviewOn,
    benchmarkTicker: rules.benchmark,
  });
  return NextResponse.json({ ok: true, ...created, warnings });
}
