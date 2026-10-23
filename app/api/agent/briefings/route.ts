import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { env } from "@/lib/env";
import { createBriefing } from "@/lib/db/agent-queries";
import { formatDiscordMessage, postToDiscord } from "@/lib/notify/discord";

const bodySchema = z.object({
  kind: z.enum(["daily", "weekly", "adhoc"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  notify: z.boolean().default(false),
  sessionUrl: z.string().url().startsWith("https://claude.ai/").optional(),
});

const FALLBACK_LINK = "https://claude.ai/code/routines";

// POST /api/agent/briefings -> save the run's briefing; with notify, also post
// it to Discord. The agent's only write, and only to agent_briefings.
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid briefing", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  let notified = false;
  const webhook = env().DISCORD_WEBHOOK_URL;
  if (b.notify && webhook) {
    notified = await postToDiscord(webhook, formatDiscordMessage(b.title, b.body, b.sessionUrl ?? FALLBACK_LINK));
  }
  const id = await createBriefing({
    kind: b.kind,
    title: b.title,
    body: b.body,
    notified,
    sessionUrl: b.sessionUrl ?? null,
  });
  return NextResponse.json({
    ok: true,
    id,
    notified,
    ...(b.notify && !webhook ? { warning: "DISCORD_WEBHOOK_URL is not set; saved without notifying" } : {}),
  });
}
