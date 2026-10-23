import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { agentBriefings, agentContext, type AgentBriefing } from "./schema";

/** The agent's goals doc and briefing history (see the schema comments). */

export const GOALS_KEY = "goals";

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
