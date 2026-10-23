import { NextResponse } from "next/server";
import { z } from "zod";
import { exchangePublicToken, newItemId } from "@/lib/plaid/link";
import { fetchAccounts } from "@/lib/plaid/accounts";
import { encrypt } from "@/lib/crypto";
import { upsertItem, upsertAccounts } from "@/lib/db/queries";
import { syncOne, finishSync } from "@/lib/plaid/sync";
import { supersedeDuplicateItems, type SupersededItem } from "@/lib/db/relink-queries";

const bodySchema = z.object({ public_token: z.string().min(1) });

// POST /api/plaid/exchange -> exchange public_token, persist item + accounts (encrypted token)
export async function POST(request: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { accessToken, itemId: plaidItemId } = await exchangePublicToken(parsed.public_token);

    // Fetch accounts + institution name before persisting so we write the item once.
    const fetched = await fetchAccounts(accessToken);

    // Persist the item with the access token encrypted at rest.
    const item = await upsertItem({
      id: newItemId(),
      plaidItemId,
      institutionName: fetched.institutionName,
      accessTokenEnc: encrypt(accessToken),
    });
    const count = await upsertAccounts(item.id, fetched.accounts);

    // Pull history immediately: the item's cursor is unset, so this first sync
    // fetches everything the institution will give us (see syncTransactions).
    // Without it a freshly linked account shows balances but no transactions
    // until something else syncs. A failure here does NOT fail the link — the
    // item is already saved, so the Sync button can retry.
    let imported: number | null = null;
    let syncError: string | null = null;
    let superseded: SupersededItem[] = [];
    try {
      const result = await syncOne(item.id, { finish: false });
      if (result.error) {
        syncError = result.error;
      } else {
        imported = result.added;
        // Only after the new item holds its own history, so overrides have
        // twins to move onto: drop any older link this one replaces, or the
        // same cards get counted twice everywhere.
        superseded = await supersedeDuplicateItems(item.id);
        await finishSync();
      }
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
    }
    if (syncError) console.error("initial sync after link failed:", syncError);
    for (const s of superseded) {
      console.log(
        `replaced stale ${s.institution} link ${s.itemId}: -${s.accounts} accounts, ` +
          `-${s.transactions} transactions, ${s.overridesMoved} overrides carried over`,
      );
    }

    return NextResponse.json({
      item_id: item.id,
      institution: fetched.institutionName,
      accounts: count,
      imported,
      sync_failed: syncError !== null,
      replaced: superseded.length,
    });
  } catch (err) {
    console.error("exchange error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to exchange public token" }, { status: 500 });
  }
}
