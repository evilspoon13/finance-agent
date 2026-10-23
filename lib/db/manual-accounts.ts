import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "./client";
import { items, accounts, holdings } from "./schema";

/**
 * Hand-entered accounts for things Plaid can't see (e.g. the invested side of
 * an HSA, a car loan at a small lender). Stored as an ordinary item + account
 * whose ids start with `manual_` (see isManualItem in lib/plaid/sync.ts), so
 * every view treats them like synced accounts; sync skips them.
 */

export const MANUAL_TYPES = ["depository", "investment", "credit", "loan"] as const;
export type ManualType = (typeof MANUAL_TYPES)[number];

export async function createManualAccount(input: {
  institution: string;
  name: string;
  type: ManualType;
  subtype: string | null;
  balanceCents: number;
}): Promise<void> {
  const id = `manual_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(items).values({
      id,
      plaidItemId: id,
      institutionName: input.institution,
      accessTokenEnc: "MANUAL",
    });
    await tx.insert(accounts).values({
      id: `${id}_acct`,
      itemId: id,
      name: input.name,
      type: input.type,
      subtype: input.subtype,
      currentBalanceCents: input.balanceCents,
    });
  });
}

/**
 * Set a manual account's value. Manual accounts are valued by their balance,
 * so any hand-entered holding rows (which would take precedence) are dropped.
 */
export async function setManualBalance(accountId: string, balanceCents: number): Promise<void> {
  if (!accountId.startsWith("manual_")) throw new Error("Only manual accounts can be edited by hand");
  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ currentBalanceCents: balanceCents, updatedAt: new Date() })
      .where(and(eq(accounts.id, accountId), like(accounts.itemId, "manual\\_%")));
    await tx.delete(holdings).where(eq(holdings.accountId, accountId));
  });
}

/** Delete an item and (by cascade) its accounts, transactions and holdings. */
export async function deleteItem(id: string): Promise<void> {
  await db.delete(items).where(eq(items.id, id));
}
