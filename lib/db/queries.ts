import { eq } from "drizzle-orm";
import type { AccountBase } from "plaid";
import { db } from "./client";
import { items, accounts, type Item, type Account } from "./schema";
import { dollarsToCents } from "@/lib/money";

/**
 * Persistence helpers for items and accounts. All upserts are keyed on the
 * Plaid-native ids so re-running is idempotent.
 */

export interface PersistItemInput {
  id: string;
  plaidItemId: string;
  institutionName: string;
  accessTokenEnc: string;
}

/** Insert a new item, or update institution/token if the plaid_item_id already exists. */
export async function upsertItem(input: PersistItemInput): Promise<Item> {
  const [row] = await db
    .insert(items)
    .values({
      id: input.id,
      plaidItemId: input.plaidItemId,
      institutionName: input.institutionName,
      accessTokenEnc: input.accessTokenEnc,
    })
    .onConflictDoUpdate({
      target: items.plaidItemId,
      set: {
        institutionName: input.institutionName,
        accessTokenEnc: input.accessTokenEnc,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

function centsOrNull(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : dollarsToCents(v);
}

/** Upsert a batch of Plaid accounts under an item. Keyed on account_id. */
export async function upsertAccounts(itemId: string, plaidAccounts: AccountBase[]): Promise<number> {
  if (plaidAccounts.length === 0) return 0;
  for (const a of plaidAccounts) {
    await db
      .insert(accounts)
      .values({
        id: a.account_id,
        itemId,
        name: a.name,
        officialName: a.official_name ?? null,
        type: String(a.type),
        subtype: a.subtype ? String(a.subtype) : null,
        mask: a.mask ?? null,
        currentBalanceCents: centsOrNull(a.balances.current),
        availableBalanceCents: centsOrNull(a.balances.available),
        isoCurrency: a.balances.iso_currency_code ?? "USD",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: a.name,
          officialName: a.official_name ?? null,
          type: String(a.type),
          subtype: a.subtype ? String(a.subtype) : null,
          mask: a.mask ?? null,
          currentBalanceCents: centsOrNull(a.balances.current),
          availableBalanceCents: centsOrNull(a.balances.available),
          isoCurrency: a.balances.iso_currency_code ?? "USD",
          updatedAt: new Date(),
        },
      });
  }
  return plaidAccounts.length;
}

export interface ItemWithAccounts extends Item {
  accounts: Account[];
}

/** List all items with their accounts, for the /connections page. */
export async function listItemsWithAccounts(): Promise<ItemWithAccounts[]> {
  const allItems = await db.select().from(items).orderBy(items.createdAt);
  const result: ItemWithAccounts[] = [];
  for (const it of allItems) {
    const accts = await db.select().from(accounts).where(eq(accounts.itemId, it.id));
    result.push({ ...it, accounts: accts });
  }
  return result;
}

export async function getItemById(id: string): Promise<Item | undefined> {
  const [row] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  return row;
}

/** All items (including encrypted tokens), for the sync runner. */
export async function getAllItems(): Promise<Item[]> {
  return db.select().from(items).orderBy(items.createdAt);
}

export async function getItemByPlaidId(plaidItemId: string): Promise<Item | undefined> {
  const [row] = await db
    .select()
    .from(items)
    .where(eq(items.plaidItemId, plaidItemId))
    .limit(1);
  return row;
}

export async function updateItemCursor(id: string, cursor: string): Promise<void> {
  await db.update(items).set({ cursor, updatedAt: new Date() }).where(eq(items.id, id));
}

export async function setItemStatusByPlaidId(
  plaidItemId: string,
  status: Item["status"],
): Promise<void> {
  await db
    .update(items)
    .set({ status, updatedAt: new Date() })
    .where(eq(items.plaidItemId, plaidItemId));
}

export async function setItemStatusById(id: string, status: Item["status"]): Promise<void> {
  await db.update(items).set({ status, updatedAt: new Date() }).where(eq(items.id, id));
}
