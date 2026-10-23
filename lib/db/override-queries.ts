import { eq } from "drizzle-orm";
import { db } from "./client";
import { transactions } from "./schema";

/**
 * The user's per-transaction overrides (see the transactions schema comments).
 * Sync never writes these columns, so they survive every resync. Only the keys
 * passed are changed; `null` clears one back to Plaid's value.
 */
export interface TransactionOverrides {
  userCategory?: string | null; // budget category, IGNORE, REIMBURSEMENT, or null
  userMemo?: string | null;
  budgetMonth?: string | null; // "YYYY-MM-01"
  amortizeMonths?: number | null;
  reimbursedCents?: number | null;
}

export async function setTransactionOverrides(id: string, o: TransactionOverrides): Promise<void> {
  await db
    .update(transactions)
    .set({ ...o, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}
