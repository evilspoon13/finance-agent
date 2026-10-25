import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { createBriefing } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  kind: z.enum(["daily", "weekly", "monthly", "adhoc"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  notify: z.boolean().default(false),
  sessionUrl: z.string().url().startsWith("https://claude.ai/").optional(),
});

// POST /api/agent/briefings -> save the run's briefing. `notify` marks it as
// needing the user (the agent alerts them itself, e.g. with a push notification).
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid briefing", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const id = await createBriefing({
    kind: b.kind,
    title: b.title,
    body: b.body,
    notified: b.notify,
    sessionUrl: b.sessionUrl ?? null,
  });
  return NextResponse.json({ ok: true, id });
}
