import { and, eq, sql, type SQL } from "drizzle-orm";
import { accounts, transactions, cards } from "../schema";
import { spendRowPredicate, inWindow } from "../spend-sql";

/** Friendly display name for an account: the card label if linked, else the
 *  (sometimes generic) Plaid account name. */
export const displayName = sql<string>`coalesce(${cards.label}, ${accounts.name})`;

export interface SpendingFilter {
  from?: Date;
  to?: Date;
  accountId?: string;
}

// What counts as spending — normal purchases plus user-categorized peer-to-peer
// payments — lives in spend-sql so every view agrees. Transfers
// and credit-card payments stay out (they'd double-count or aren't consumption),
// except a P2P app payment the user has tagged with a real budget category.
export function spendingWhere(f: SpendingFilter): SQL | undefined {
  const clauses: SQL[] = [
    // Outflows only (positive = money leaving the account).
    sql`${transactions.amountCents} > 0`,
    sql`${transactions.pending} = false`,
    spendRowPredicate(),
    // Date filter lives in inWindow() so amortized charges can reach into the
    // window from an earlier month (see spend-sql).
    inWindow(f),
  ];
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  return and(...clauses);
}
