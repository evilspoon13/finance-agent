import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { AGENT_SOURCES, KNOWLEDGE_TOPICS } from "@/lib/agent/knowledge";
import { listKnowledge, writeKnowledge } from "@/lib/db/agent-queries";

const bodySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  topic: z.enum(KNOWLEDGE_TOPICS),
  body: z.string().trim().min(1).max(4_000),
  source: z.enum(AGENT_SOURCES),
  sessionUrl: z.string().url().startsWith("https://claude.ai/").optional(),
  expiresOn: z.iso.date().optional(),
});

// GET /api/agent/knowledge -> live and pending facts.
export async function GET(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  return NextResponse.json({ knowledge: await listKnowledge() });
}

// POST /api/agent/knowledge -> record one fact. The response says what happened
// to it: live, waiting for the user's review, or ignored (and why).
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid knowledge", issues: parsed.error.issues }, { status: 400 });
  }
  const decision = await writeKnowledge(parsed.data);
  return NextResponse.json(
    decision.outcome === "noop" ? { ok: true, stored: false, reason: decision.reason } : { ok: true, stored: true, status: decision.status },
  );
}
