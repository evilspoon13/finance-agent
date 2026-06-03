import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { aiUnavailableMessage } from "@/lib/ai/client";

const bodySchema = z.object({
  question: z.string().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .optional(),
});

// POST /api/ai/ask -> tool-using agent answers a finance question over read-only data.
export async function POST(request: Request) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const answer = await runAgent(body.question, body.history ?? []);
    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(msg)) {
      return NextResponse.json({ error: aiUnavailableMessage() }, { status: 503 });
    }
    console.error("ai ask error:", msg);
    return NextResponse.json({ error: "Failed to answer" }, { status: 500 });
  }
}
