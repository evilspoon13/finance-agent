/**
 * Phase 2 self-verification (Sandbox) — no dev server required.
 *
 * 1. Mints a Sandbox item and persists it through the real exchange code path
 *    (token encrypted at rest).
 * 2. Runs syncAllItems() twice and asserts the second run does not change the
 *    transaction count (idempotent cursor sync).
 * 3. Reports balances + holdings and confirms the stored access token is
 *    ciphertext, not plaintext.
 *
 * Run: npm run verify:phase2
 */
import "dotenv/config";
import { Configuration, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { transactions, items, accounts, holdings } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { exchangePublicToken, newItemId } from "@/lib/plaid/link";
import { fetchAccounts } from "@/lib/plaid/accounts";
import { upsertItem, upsertAccounts } from "@/lib/db/queries";
import { syncAllItems } from "@/lib/plaid/sync";

const INSTITUTION = "ins_109508"; // Plaid Sandbox

function rawPlaid(): PlaidApi {
  const env = (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "production";
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET": process.env.PLAID_SECRET,
        },
      },
    }),
  );
}

async function count(table: typeof transactions | typeof accounts | typeof holdings) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

async function main() {
  let failures = 0;
  const assert = (cond: boolean, label: string) => {
    console.log(`${cond ? "✓" : "✗"} ${label}`);
    if (!cond) failures += 1;
  };

  // 0. Clean slate so counts are deterministic (cascades to accounts/txns/holdings).
  await db.execute(sql`truncate table ${items} cascade`);

  // 1. Link a Sandbox item via the real exchange path.
  console.log("→ Creating Sandbox item…");
  const pt = await rawPlaid().sandboxPublicTokenCreate({
    institution_id: INSTITUTION,
    initial_products: [Products.Transactions],
  });
  const { accessToken, itemId: plaidItemId } = await exchangePublicToken(pt.data.public_token);
  const fetched = await fetchAccounts(accessToken);
  const item = await upsertItem({
    id: newItemId(),
    plaidItemId,
    institutionName: fetched.institutionName,
    accessTokenEnc: encrypt(accessToken),
  });
  await upsertAccounts(item.id, fetched.accounts);
  console.log(`  linked ${fetched.institutionName} (${fetched.accounts.length} accounts)`);

  // Token must be encrypted at rest.
  const [stored] = await db
    .select()
    .from(items)
    .where(sql`${items.id} = ${item.id}`);
  assert(!!stored && stored.accessTokenEnc !== accessToken, "access token stored encrypted");
  assert(!!stored && stored.accessTokenEnc.split(":").length === 3, "ciphertext is iv:tag:data");

  // 2. Sync until Sandbox finishes generating the initial transactions.
  //    (A fresh Sandbox item returns added:0 until its data is ready; in
  //    production the SYNC_UPDATES_AVAILABLE webhook triggers this instead.)
  console.log("→ Syncing until transactions are ready…");
  let noError = true;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const r = await syncAllItems();
    noError &&= r.every((x) => !x.error);
    const n = await count(transactions);
    console.log(`  attempt ${attempt}: total transactions = ${n}`);
    if (n > 0) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  const t1 = await count(transactions);
  assert(noError, "syncs had no errors");
  assert(t1 > 0, `transactions populated (${t1})`);

  // 3. One more sync against the now-stable state.
  //    Spec acceptance: re-running produces no duplicates and advances the cursor.
  //    (Some added/removed churn is legitimate — Sandbox settles pending txns,
  //    which exercises the pending->posted replacement path.)
  console.log("→ Idempotency re-run…");
  await syncAllItems();
  const t2 = await count(transactions);
  assert(t2 === t1, `re-run did not duplicate transactions (${t1} -> ${t2})`);

  // Cursor must be set (advanced past the initial empty state).
  const [afterItem] = await db.select().from(items);
  assert(!!afterItem?.cursor, "per-item cursor persisted/advanced");

  // Pending->posted dedup: no row's id should equal another row's
  // pending_transaction_id (i.e. a pending placeholder and its posted twin
  // must never coexist).
  const [dup] = await db.execute(sql`
    select count(*)::int as n
    from ${transactions} t
    where exists (
      select 1 from ${transactions} p
      where p.pending_transaction_id = t.id
    )
  `);
  assert((dup as { n: number } | undefined)?.n === 0, "no pending+posted duplicate pairs");

  // 4. Balances + holdings summary.
  const [bal] = await db
    .select({ n: sql<number>`count(*) filter (where ${accounts.currentBalanceCents} is not null)::int` })
    .from(accounts);
  assert((bal?.n ?? 0) > 0, "at least one account balance populated");
  console.log(`  holdings rows: ${await count(holdings)}`);

  console.log(failures === 0 ? "\nPHASE 2 OK ✅" : `\n${failures} CHECK(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
