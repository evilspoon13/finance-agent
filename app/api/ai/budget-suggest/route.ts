import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestBudget } from "@/lib/ai/budget-suggest";
import { aiUnavailableMessage } from "@/lib/ai/client";
import { dollarsToCents } from "@/lib/money";

const bodySchema = z.object({
  incomeDollars: z.coerce.number().positive().max(10_000_000),
  note: z.string().max(300).optional(),
});

// POST /api/ai/budget-suggest -> AI proposes per-category monthly limits from
// the user's income, grounded in their recent average spend.
export async function POST(request: Request) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const plan = await suggestBudget(dollarsToCents(body.incomeDollars), body.note);
    return NextResponse.json({ plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(msg)) {
      return NextResponse.json({ error: aiUnavailableMessage() }, { status: 503 });
    }
    console.error("budget suggest error:", msg);
    return NextResponse.json({ error: "Failed to generate budget" }, { status: 500 });
  }
}
