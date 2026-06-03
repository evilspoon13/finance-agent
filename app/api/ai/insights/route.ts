import { NextResponse } from "next/server";
import { z } from "zod";
import { getInsight } from "@/lib/ai/insights";
import { aiUnavailableMessage } from "@/lib/ai/client";

const bodySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  account: z.string().optional(),
  force: z.boolean().optional(),
});

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

// POST /api/ai/insights -> grounded narrative summary for the given spending range.
export async function POST(request: Request) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await getInsight(
      {
        from: parseDate(body.from),
        to: parseDate(body.to, true),
        accountId: body.account,
      },
      body.force ?? false,
    );
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Connection refused etc. -> the local model server isn't up.
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(msg)) {
      return NextResponse.json({ error: aiUnavailableMessage() }, { status: 503 });
    }
    console.error("ai insights error:", msg);
    return NextResponse.json({ error: "Failed to generate insight" }, { status: 500 });
  }
}
