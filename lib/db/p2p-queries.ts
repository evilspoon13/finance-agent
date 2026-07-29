import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { transactions } from "./schema";
import { P2P_OUT_DETAILED, IGNORE_CATEGORY } from "./spend-sql";

/**
 * Writes for the peer-to-peer categorize flow. Every update is fenced to
 * outgoing app payments (P2P_OUT_DETAILED) so nothing else can be relabeled by
 * a stray id — the review screen only ever touches these rows.
 */

/** Tag a P2P payment with a budget category + optional note (counts as spend). */
export async function setP2PCategory(
  id: string,
  category: string,
  memo: string | null,
): Promise<void> {
  await db
    .update(transactions)
    .set({ userCategory: category, userMemo: memo, updatedAt: new Date() })
    .where(and(eq(transactions.id, id), eq(transactions.pfcDetailed, P2P_OUT_DETAILED)));
}

/** Dismiss a P2P payment as "not spending" so it stops appearing for review. */
export async function ignoreP2P(id: string): Promise<void> {
  await db
    .update(transactions)
    .set({ userCategory: IGNORE_CATEGORY, userMemo: null, updatedAt: new Date() })
    .where(and(eq(transactions.id, id), eq(transactions.pfcDetailed, P2P_OUT_DETAILED)));
}

/** Undo a categorization / dismissal, putting the payment back on the list. */
export async function resetP2PCategory(id: string): Promise<void> {
  await db
    .update(transactions)
    .set({ userCategory: null, userMemo: null, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.pfcDetailed, P2P_OUT_DETAILED),
        sql`${transactions.userCategory} is not null`,
      ),
    );
}
