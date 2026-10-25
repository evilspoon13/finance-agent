import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { setContext, NOTES_KEY } from "@/lib/db/agent-queries";

const bodySchema = z.object({ body: z.string().trim().min(1).max(20_000) });

// PUT /api/agent/notes {body} -> replace the agent's running notes (its memory
// across runs). The whole doc each time: read it from the summary, edit, send back.
export async function PUT(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid notes", issues: parsed.error.issues }, { status: 400 });
  }
  await setContext(NOTES_KEY, parsed.data.body);
  return NextResponse.json({ ok: true, chars: parsed.data.body.length });
}
