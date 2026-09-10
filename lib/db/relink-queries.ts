import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Re-linking an institution through Plaid Link sometimes yields a brand-new
 * item (new access token, new account ids, new transaction ids) rather than
 * reusing the existing one. Both items then sync, so the same physical card is
 * counted twice — doubled balances on the net-worth page and doubled spending
 * on the budgets page.
 *
 * When a freshly linked item covers the same institution and shares an account
 * mask with an older one, the new item supersedes it: the old link is stale by
 * definition (Plaid only issues a new item when the old consent is replaced).
 * So we carry the user's overrides onto the surviving rows and drop the old
 * item, whose accounts and transactions cascade away with it.
 */

export interface SupersededItem {
  itemId: string;
  institution: string;
  accounts: number;
  transactions: number;
  overridesMoved: number;
}

/**
 * Items that the given item replaces: same institution, at least one shared
 * account mask, different id. Masks are the only stable identifier across a
 * re-link — Plaid's account ids are per-item.
 */
async function findSuperseded(newItemId: string): Promise<{ id: string; institutionName: string }[]> {
  const rows = await db.execute<{ id: string; institution_name: string }>(sql`
    select distinct old.id, old.institution_name
    from items old
    join accounts ao on ao.item_id = old.id
    join accounts an on an.mask = ao.mask and an.item_id = ${newItemId}
    join items new on new.id = ${newItemId}
    where old.id <> ${newItemId}
      and old.institution_name = new.institution_name
      and ao.mask is not null
  `);
  return rows.map((r) => ({ id: r.id, institutionName: r.institution_name }));
}

/**
 * Copy user-owned fields from the old item's rows onto their twins under the
 * new item. A twin is the same account (by mask), amount, posted date and
 * merchant — Plaid re-issues transaction ids per item, so identity has to be
 * reconstructed from the transaction's content.
 */
async function carryOverrides(oldItemId: string, newItemId: string): Promise<number> {
  const res = await db.execute(sql`
    with twin as (
      select new.id as new_id, old.user_category, old.user_memo,
             old.amortize_months, old.budget_month
      from transactions old
      join accounts ao on ao.id = old.account_id and ao.item_id = ${oldItemId}
      join accounts an on an.mask = ao.mask and an.item_id = ${newItemId}
      join transactions new on new.account_id = an.id
        and new.amount_cents = old.amount_cents
        and new.posted_at = old.posted_at
        and coalesce(new.merchant_name, new.name) = coalesce(old.merchant_name, old.name)
      where old.user_category is not null
         or old.amortize_months is not null
         or old.budget_month is not null
    )
    update transactions t
    set user_category = twin.user_category, user_memo = twin.user_memo,
        amortize_months = twin.amortize_months, budget_month = twin.budget_month
    from twin where t.id = twin.new_id
    returning t.id
  `);
  return res.length;
}

/**
 * Point the user's configured cards (labels, earn rules) at the surviving
 * accounts, and drop any bare card row `seedCards` created for the new item
 * that duplicates one of them. Without this the rewards page shows the same
 * physical card twice — once configured, once as a nameless "CREDIT CARD".
 */
async function repointCards(oldItemId: string, newItemId: string): Promise<void> {
  await db.execute(sql`
    delete from cards c using accounts a, accounts ao, cards c2
    where c.account_id = a.id and a.item_id = ${newItemId}
      and ao.item_id = ${oldItemId} and ao.mask = a.mask
      and c2.account_id = ao.id and c2.id <> c.id
  `);
  await db.execute(sql`
    update cards c set account_id = an.id
    from accounts ao join accounts an on an.mask = ao.mask and an.item_id = ${newItemId}
    where c.account_id = ao.id and ao.item_id = ${oldItemId}
  `);
}

/**
 * Drop any item the freshly linked `newItemId` supersedes, preserving the
 * user's categorization and card setup. Safe to call after every new link:
 * with nothing to supersede it does nothing and returns an empty list.
 */
export async function supersedeDuplicateItems(newItemId: string): Promise<SupersededItem[]> {
  const stale = await findSuperseded(newItemId);
  const done: SupersededItem[] = [];

  for (const old of stale) {
    const [counted] = await db.execute<{ accounts: number; transactions: number }>(sql`
      select
        (select count(*)::int from accounts where item_id = ${old.id}) as accounts,
        (select count(*)::int from transactions t
           join accounts a on a.id = t.account_id where a.item_id = ${old.id}) as transactions
    `);
    const overridesMoved = await carryOverrides(old.id, newItemId);
    await repointCards(old.id, newItemId);
    // Accounts and their transactions cascade from the item.
    await db.execute(sql`delete from items where id = ${old.id}`);

    done.push({
      itemId: old.id,
      institution: old.institutionName,
      accounts: counted?.accounts ?? 0,
      transactions: counted?.transactions ?? 0,
      overridesMoved,
    });
  }
  return done;
}
