import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { categoryRules, transactions, type CategoryRule } from "./schema";

/**
 * "Merchant contains X → category" rules (see the category_rules schema
 * comment). A rule only fills in rows the user hasn't overridden, so a
 * per-transaction choice always beats a rule.
 */

export async function listRules(): Promise<CategoryRule[]> {
  return db.select().from(categoryRules).orderBy(desc(categoryRules.createdAt));
}

/** Create a rule and apply it right away. Returns how many rows it tagged. */
export async function createRule(match: string, category: string): Promise<number> {
  const rule = { id: randomUUID(), match: match.trim(), category };
  await db.insert(categoryRules).values(rule);
  return applyRule(rule);
}

export async function deleteRule(id: string): Promise<void> {
  // Rows it already tagged keep their category: once applied, a rule's result
  // is an ordinary override the user can change per transaction.
  await db.delete(categoryRules).where(eq(categoryRules.id, id));
}

async function applyRule(rule: Pick<CategoryRule, "match" | "category">): Promise<number> {
  const pattern = `%${rule.match.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const hit = await db
    .update(transactions)
    .set({ userCategory: rule.category, updatedAt: new Date() })
    .where(
      sql`${transactions.userCategory} is null and (coalesce(${transactions.merchantName}, '') ilike ${pattern} or ${transactions.name} ilike ${pattern})`,
    )
    .returning({ id: transactions.id });
  return hit.length;
}

/** Apply every rule to rows without an override (run after each sync). */
export async function applyCategoryRules(): Promise<number> {
  let total = 0;
  // Oldest first, so when two rules match the same row the older one wins.
  for (const rule of (await listRules()).reverse()) total += await applyRule(rule);
  return total;
}
