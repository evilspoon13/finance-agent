import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { SYMBOL_PATTERN } from "@/lib/agent/market";
import { upsertIdea } from "@/lib/db/research-queries";

const text = z.string().trim().max(6_000).optional();
const bodySchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(SYMBOL_PATTERN),
  name: z.string().trim().max(200).optional(),
  status: z.enum(["researching", "watch", "rejected"]), // "proposed" and "owned" come from the decision flow
  thesis: text,
  bearCase: text,
  valuation: text,
  invalidation: text,
  nextReviewOn: z.iso.date().optional(),
});

// PUT /api/agent/research/ideas -> add or update one watchlist entry.
export async function PUT(request: Request) {
  const denied = agentGuard(request, "research");
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid idea", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ticker: await upsertIdea(parsed.data) });
}
