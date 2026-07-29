import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { aiUnavailableMessage, isRateLimited } from "@/lib/ai/client";
import {
  conversationExists,
  getMessages,
  appendMessage,
  touchConversation,
  renameConversation,
} from "@/lib/db/conversation-queries";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  question: z.string().min(1).max(1000),
});

/** First user message becomes the conversation title (trimmed to a short label). */
function titleFrom(question: string): string {
  const t = question.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

// POST /api/ai/ask -> answer a finance question in a conversation. Loads prior
// turns from the DB as history, runs the read-only agent, and persists both the
// question and the answer so the conversation is durable and self-contained.
export async function POST(request: Request) {
  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!(await conversationExists(body.conversationId))) {
    return NextResponse.json({ error: "Unknown conversation" }, { status: 404 });
  }

  try {
    const prior = await getMessages(body.conversationId);
    const history = prior.map((m) => ({ role: m.role, content: m.content }));

    const answer = await runAgent(body.question, history);

    if (prior.length === 0) await renameConversation(body.conversationId, titleFrom(body.question));
    await appendMessage(body.conversationId, "user", body.question);
    await appendMessage(body.conversationId, "assistant", answer);
    await touchConversation(body.conversationId);

    return NextResponse.json({ answer });
  } catch (err) {
    if (isRateLimited(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(msg)) {
      return NextResponse.json({ error: aiUnavailableMessage() }, { status: 503 });
    }
    console.error("ai ask error:", msg);
    return NextResponse.json({ error: "Failed to answer" }, { status: 500 });
  }
}
