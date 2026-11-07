import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { createMemo } from "@/lib/db/research-queries";

const bodySchema = z.object({
  kind: z.enum(["pulse", "weekly", "deep_dive"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(60_000),
  sources: z
    .array(z.object({ title: z.string().max(300), url: z.url({ protocol: /^https?$/ }).max(1_000), date: z.string().max(30).optional() }))
    .max(200)
    .default([]),
  sessionUrl: z.string().url().startsWith("https://claude.ai/").optional(),
});

// POST /api/agent/research/memos -> save a research memo. Sources are required
// reading for whoever acts on it, so each claim can be traced.
export async function POST(request: Request) {
  const denied = agentGuard(request, "research");
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memo", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: await createMemo(parsed.data) });
}
