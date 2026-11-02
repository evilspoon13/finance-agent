import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
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

const DAY_MS = 86_400_000;

/**
 * The posted row that stands for a pending one. Plaid links them with
 * `pending_transaction_id` when the bank provides it; otherwise the bank posts
 * the charge under a new id with no link (and the pending row can linger for a
 * day or two), so match on account + exact amount, posted within a few days of
 * the pending date, nearest first.
 */
export async function findPostedTwin(p: {
  id: string;
  accountId: string;
  amountCents: number;
  postedAt: Date | null;
}): Promise<string | null> {
  const [linked] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.pendingTransactionId, p.id), eq(transactions.pending, false)))
    .limit(1);
  if (linked) return linked.id;
  if (!p.postedAt) return null;

  const at = p.postedAt.getTime();
  const [match] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, p.accountId),
        eq(transactions.amountCents, p.amountCents),
        eq(transactions.pending, false),
        ne(transactions.id, p.id),
        gte(transactions.postedAt, new Date(at - 3 * DAY_MS)),
        lte(transactions.postedAt, new Date(at + 10 * DAY_MS)),
      ),
    )
    .orderBy(asc(sql`abs(extract(epoch from ${transactions.postedAt} - ${p.postedAt.toISOString()}::timestamptz))`))
    .limit(1);
  return match?.id ?? null;
}

/**
 * Copy a pending row's overrides onto the posted row that replaced it, keeping
 * any the posted row already has. Used by sync before a pending row is deleted.
 */
export async function carryOverrides(fromId: string, toId: string): Promise<void> {
  const t = transactions;
  const [from] = await db
    .select({
      userCategory: t.userCategory,
      userMemo: t.userMemo,
      budgetMonth: t.budgetMonth,
      amortizeMonths: t.amortizeMonths,
      reimbursedCents: t.reimbursedCents,
    })
    .from(t)
    .where(eq(t.id, fromId));
  if (!from || Object.values(from).every((v) => v == null)) return;
  await db
    .update(t)
    .set({
      userCategory: sql`coalesce(${t.userCategory}, ${from.userCategory})`,
      userMemo: sql`coalesce(${t.userMemo}, ${from.userMemo})`,
      budgetMonth: sql`coalesce(${t.budgetMonth}, ${from.budgetMonth}::date)`,
      amortizeMonths: sql`coalesce(${t.amortizeMonths}, ${from.amortizeMonths}::int)`,
      reimbursedCents: sql`coalesce(${t.reimbursedCents}, ${from.reimbursedCents}::int)`,
      updatedAt: new Date(),
    })
    .where(eq(t.id, toId));
}

/**
 * Save overrides. Editing a pending row also edits its posted twin when one
 * already exists, since only the posted row counts toward budgets.
 */
export async function setTransactionOverrides(id: string, o: TransactionOverrides): Promise<void> {
  const [row] = await db
    .update(transactions)
    .set({ ...o, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning({
      id: transactions.id,
      pending: transactions.pending,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
    });
  if (!row?.pending) return;
  const twin = await findPostedTwin(row);
  if (twin) {
    await db
      .update(transactions)
      .set({ ...o, updatedAt: new Date() })
      .where(eq(transactions.id, twin));
  }
}
