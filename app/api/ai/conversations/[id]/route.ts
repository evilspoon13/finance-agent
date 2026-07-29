import { NextResponse } from "next/server";
import { z } from "zod";
import {
  conversationExists,
  getMessages,
  renameConversation,
  deleteConversation,
} from "@/lib/db/conversation-queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/ai/conversations/[id] -> the conversation's message transcript.
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await conversationExists(id))) {
    return NextResponse.json({ error: "Unknown conversation" }, { status: 404 });
  }
  const rows = await getMessages(id);
  const messages = rows.map((m) => ({ role: m.role, content: m.content }));
  return NextResponse.json({ messages });
}

const patchSchema = z.object({ title: z.string().min(1).max(200) });

// PATCH /api/ai/conversations/[id] -> rename.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  let body;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!(await conversationExists(id))) {
    return NextResponse.json({ error: "Unknown conversation" }, { status: 404 });
  }
  await renameConversation(id, body.title);
  return NextResponse.json({ ok: true });
}

// DELETE /api/ai/conversations/[id] -> delete (messages cascade).
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteConversation(id);
  return NextResponse.json({ ok: true });
}
