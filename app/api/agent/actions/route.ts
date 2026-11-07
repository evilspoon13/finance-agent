import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { createAction } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2_000).optional(),
  dueOn: z.iso.date().optional(),
  kind: z.enum(["action", "question"]).default("action"),
});

// POST /api/agent/actions {title, detail?, dueOn?, kind?} -> open a follow-up, or ask the
// user a question they can answer on /briefings.
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action", issues: parsed.error.issues }, { status: 400 });
  }
  const id = await createAction(parsed.data);
  return NextResponse.json({ ok: true, id });
}
