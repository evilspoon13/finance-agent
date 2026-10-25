import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { createAction } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2_000).optional(),
  dueOn: z.iso.date().optional(),
});

// POST /api/agent/actions {title, detail?, dueOn?} -> open a follow-up for the user.
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
