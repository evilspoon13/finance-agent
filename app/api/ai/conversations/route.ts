import { NextResponse } from "next/server";
import { listConversations, createConversation } from "@/lib/db/conversation-queries";

export const dynamic = "force-dynamic";

// GET /api/ai/conversations -> list conversations (most recently active first).
export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

// POST /api/ai/conversations -> create a new (empty) conversation.
export async function POST() {
  const conversation = await createConversation();
  return NextResponse.json({ conversation }, { status: 201 });
}
