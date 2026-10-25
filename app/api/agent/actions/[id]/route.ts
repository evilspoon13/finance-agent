import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { setActionStatus } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  status: z.enum(["open", "done", "dismissed"]),
  note: z.string().trim().max(2_000).optional(),
});

// PATCH /api/agent/actions/:id {status, note?} -> close (or reopen) a follow-up.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update", issues: parsed.error.issues }, { status: 400 });
  }
  const { id } = await params;
  const found = await setActionStatus(id, parsed.data.status, parsed.data.note);
  if (!found) return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
