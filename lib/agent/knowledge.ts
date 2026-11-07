/**
 * Write rules for the agent's knowledge base. A misread reply once became a
 * "fact" in free-form notes and steered later runs, so trust is decided here, in
 * code, not by the prompt:
 *  - only the app can write `user` rows (the user typed or confirmed them);
 *  - `observed` facts, seen in the data, go live, unless they contradict a user row;
 *  - `reported` (a paraphrased reply) and `inferred` wait for the user's review.
 */

export const KNOWLEDGE_TOPICS = [
  "profile",
  "comp",
  "tax",
  "accounts",
  "cashflow",
  "merchants",
  "investing_policy",
  "standing_rule",
  "baseline",
] as const;

export const AGENT_SOURCES = ["observed", "reported", "inferred"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export interface ExistingKnowledge {
  id: string;
  body: string;
  source: string;
  status: string;
}

export type KnowledgeDecision =
  | { outcome: "noop"; reason: string }
  | { outcome: "write"; status: "active" | "pending_review"; supersede: string[] };

/** What to do with an agent write, given the rows already stored under its slug. */
export function decideKnowledgeWrite(source: AgentSource, body: string, existing: ExistingKnowledge[]): KnowledgeDecision {
  const active = existing.find((r) => r.status === "active");
  const pending = existing.filter((r) => r.status === "pending_review");

  if (active?.body === body) return { outcome: "noop", reason: "Already known" };
  if (pending.some((r) => r.body === body)) return { outcome: "noop", reason: "Already waiting for review" };
  if (existing.some((r) => r.status === "rejected" && r.body === body)) {
    return { outcome: "noop", reason: "The user rejected this" };
  }

  const goesLive = source === "observed" && active?.source !== "user";
  if (!goesLive) return { outcome: "write", status: "pending_review", supersede: pending.map((r) => r.id) };
  return { outcome: "write", status: "active", supersede: [...(active ? [active.id] : []), ...pending.map((r) => r.id)] };
}
