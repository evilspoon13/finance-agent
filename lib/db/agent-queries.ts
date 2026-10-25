import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ne, or } from "drizzle-orm";
import { db } from "./client";
import { agentActions, agentBriefings, agentContext, type AgentAction, type AgentBriefing } from "./schema";

/** The agent's goals doc, notes, action items and briefing history (see the schema comments). */

export const GOALS_KEY = "goals";
export const NOTES_KEY = "notes";

export async function getContext(key: string): Promise<string | null> {
  const [row] = await db.select({ body: agentContext.body }).from(agentContext).where(eq(agentContext.key, key));
  return row?.body ?? null;
}

export async function setContext(key: string, body: string): Promise<void> {
  await db
    .insert(agentContext)
    .values({ key, body })
    .onConflictDoUpdate({ target: agentContext.key, set: { body, updatedAt: new Date() } });
}

export async function listBriefings(limit = 50): Promise<AgentBriefing[]> {
  return db.select().from(agentBriefings).orderBy(desc(agentBriefings.createdAt)).limit(limit);
}

export async function createBriefing(input: {
  kind: string;
  title: string;
  body: string;
  notified: boolean;
  sessionUrl: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(agentBriefings).values({ id, ...input });
  return id;
}

export type ActionStatus = AgentAction["status"];

/** Open actions, plus ones closed in the last `recentDays` (so a run sees what just got done). */
export async function listActions(recentDays = 14): Promise<AgentAction[]> {
  const since = new Date(Date.now() - recentDays * 864e5);
  return db
    .select()
    .from(agentActions)
    .where(or(eq(agentActions.status, "open"), gte(agentActions.resolvedAt, since)))
    .orderBy(desc(agentActions.createdAt));
}

export async function createAction(input: { title: string; detail?: string; dueOn?: string }): Promise<string> {
  const id = randomUUID();
  await db.insert(agentActions).values({ id, title: input.title, detail: input.detail, dueOn: input.dueOn });
  return id;
}

/** Close (or reopen) an action. Returns false when the id doesn't exist. */
export async function setActionStatus(id: string, status: ActionStatus, note?: string): Promise<boolean> {
  const rows = await db
    .update(agentActions)
    .set({ status, note: note ?? null, resolvedAt: status === "open" ? null : new Date() })
    .where(and(eq(agentActions.id, id), ne(agentActions.status, status)))
    .returning({ id: agentActions.id });
  if (rows.length) return true;
  const [exists] = await db.select({ id: agentActions.id }).from(agentActions).where(eq(agentActions.id, id));
  return Boolean(exists);
}
