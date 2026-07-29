import { randomUUID } from "node:crypto";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "./client";
import { conversations, messages, type Message } from "./schema";

/**
 * CRUD for the AI chat sidebar. Conversations are listed most-recently-active
 * first; messages are the visible user/assistant transcript the agent replays
 * as history.
 */

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));
}

export async function createConversation(title = "New chat"): Promise<ConversationSummary> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(conversations).values({ id, title, createdAt: now, updatedAt: now });
  return { id, title, updatedAt: now };
}

export async function conversationExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return Boolean(row);
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await db
    .insert(messages)
    .values({ id: randomUUID(), conversationId, role, content, createdAt: new Date() });
}

/** Bump updatedAt so the conversation floats to the top of the list. */
export async function touchConversation(id: string): Promise<void> {
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id));
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function deleteConversation(id: string): Promise<void> {
  await db.delete(conversations).where(eq(conversations.id, id)); // messages cascade
}
