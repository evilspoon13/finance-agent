import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { decideKnowledgeWrite, type AgentSource, type KnowledgeDecision } from "@/lib/agent/knowledge";
import { db } from "./client";
import {
  agentActions,
  agentBriefings,
  agentContext,
  agentKnowledge,
  agentScorecards,
  type AgentAction,
  type AgentBriefing,
  type AgentKnowledge,
} from "./schema";

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

/** Merge the newest briefings with the latest of each kind, newest first, without repeats. */
export function mergeBriefings(recent: AgentBriefing[], latestPerKind: AgentBriefing[]): AgentBriefing[] {
  const byId = new Map([...recent, ...latestPerKind].map((b) => [b.id, b]));
  return [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * What a run sees of its own history: the last few briefings plus the latest of
 * each kind, so daily runs can't push last week's weekly out of view.
 */
export async function briefingsForAgent(limit = 5): Promise<AgentBriefing[]> {
  const [recent, latestPerKind] = await Promise.all([
    listBriefings(limit),
    db
      .selectDistinctOn([agentBriefings.kind])
      .from(agentBriefings)
      .orderBy(agentBriefings.kind, desc(agentBriefings.createdAt)),
  ]);
  return mergeBriefings(recent, latestPerKind);
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

export async function createAction(input: {
  title: string;
  detail?: string;
  dueOn?: string;
  kind?: "action" | "question";
}): Promise<string> {
  const id = randomUUID();
  await db.insert(agentActions).values({ id, title: input.title, detail: input.detail, dueOn: input.dueOn, kind: input.kind });
  return id;
}

/**
 * Save the user's answer to a question. It also goes straight into the knowledge
 * base in their exact words, so it reaches every later run with no paraphrasing.
 */
export async function answerQuestion(id: string, answer: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [q] = await tx
      .update(agentActions)
      .set({ answer, status: "done", resolvedAt: now })
      .where(and(eq(agentActions.id, id), eq(agentActions.kind, "question")))
      .returning({ title: agentActions.title });
    if (!q) return false;
    const slug = `answer-${id}`;
    await tx.update(agentKnowledge).set({ status: "superseded", updatedAt: now }).where(and(eq(agentKnowledge.slug, slug), eq(agentKnowledge.status, "active")));
    await tx.insert(agentKnowledge).values({
      id: randomUUID(),
      slug,
      topic: "profile",
      body: `Q: ${q.title}\nA (user's words): ${answer}`,
      source: "user",
      status: "active",
      verifiedAt: now,
    });
    return true;
  });
}

/** Everything still in play: live facts and those waiting for review. */
export async function listKnowledge(): Promise<AgentKnowledge[]> {
  return db
    .select()
    .from(agentKnowledge)
    .where(inArray(agentKnowledge.status, ["active", "pending_review"]))
    .orderBy(agentKnowledge.topic, agentKnowledge.slug);
}

export async function countPendingKnowledge(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentKnowledge)
    .where(eq(agentKnowledge.status, "pending_review"));
  return row?.n ?? 0;
}

/** An agent write. The rules in lib/agent/knowledge.ts decide how far it goes. */
export async function writeKnowledge(input: {
  slug: string;
  topic: string;
  body: string;
  source: AgentSource;
  sessionUrl?: string;
  expiresOn?: string;
}): Promise<KnowledgeDecision> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(agentKnowledge).where(eq(agentKnowledge.slug, input.slug)).for("update");
    const decision = decideKnowledgeWrite(input.source, input.body, existing);
    if (decision.outcome === "noop") return decision;
    if (decision.supersede.length) {
      await tx
        .update(agentKnowledge)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(inArray(agentKnowledge.id, decision.supersede));
    }
    await tx.insert(agentKnowledge).values({ id: randomUUID(), ...input, status: decision.status });
    return decision;
  });
}

/** The user's own fact, added or edited on /knowledge. Replaces whatever is live or pending under the slug. */
export async function saveUserKnowledge(input: { slug: string; topic: string; body: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(agentKnowledge)
      .set({ status: "superseded", updatedAt: now })
      .where(and(eq(agentKnowledge.slug, input.slug), inArray(agentKnowledge.status, ["active", "pending_review"])));
    await tx.insert(agentKnowledge).values({ id: randomUUID(), ...input, source: "user", status: "active", verifiedAt: now });
  });
}

/** The user confirms a pending row: it goes live as their own and replaces the live one. */
export async function confirmKnowledge(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.select().from(agentKnowledge).where(eq(agentKnowledge.id, id));
    if (!row || row.status !== "pending_review") return;
    await tx
      .update(agentKnowledge)
      .set({ status: "superseded", updatedAt: now })
      .where(and(eq(agentKnowledge.slug, row.slug), eq(agentKnowledge.status, "active")));
    await tx
      .update(agentKnowledge)
      .set({ status: "active", source: "user", verifiedAt: now, updatedAt: now })
      .where(eq(agentKnowledge.id, id));
  });
}

export async function rejectKnowledge(id: string): Promise<void> {
  await db.update(agentKnowledge).set({ status: "rejected", updatedAt: new Date() }).where(eq(agentKnowledge.id, id));
}

export async function saveScorecard(kind: string, period: string, metrics: unknown): Promise<void> {
  await db
    .insert(agentScorecards)
    .values({ kind, period, metrics })
    .onConflictDoUpdate({ target: [agentScorecards.kind, agentScorecards.period], set: { metrics, createdAt: new Date() } });
}

/** The most recent scorecards, newest first. */
export async function listScorecards(limit = 8) {
  return db.select().from(agentScorecards).orderBy(desc(agentScorecards.createdAt)).limit(limit);
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
