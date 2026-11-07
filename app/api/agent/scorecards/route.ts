import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { saveScorecard } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  kind: z.enum(["weekly", "monthly"]),
  period: z.string().trim().min(4).max(20),
  metrics: z.record(z.string(), z.unknown()),
});

// POST /api/agent/scorecards -> this run's numbers, for the next run to compare
// against. Same kind and period replaces the row.
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scorecard", issues: parsed.error.issues }, { status: 400 });
  }
  await saveScorecard(parsed.data.kind, parsed.data.period, parsed.data.metrics);
  return NextResponse.json({ ok: true });
}
