/**
 * Remove Plaid item(s) so they can be re-linked fresh (a new link applies
 * days_requested=730 and pulls full history; update-mode reconnect on a
 * healthy item does NOT). For each matched item this calls Plaid /item/remove
 * to invalidate the access token, then deletes the DB item row (accounts,
 * transactions and holdings cascade away).
 *
 * Usage:
 *   npx tsx scripts/remove-item.ts                 # dry-run: list items
 *   npx tsx scripts/remove-item.ts Chase Discover  # remove by name match
 *   npx tsx scripts/remove-item.ts --all           # remove every item
 *
 * After running, re-add each institution from the Connections page
 * ("Connect an account") to backfill ~2 years of history.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getAllItems } from "@/lib/db/queries";
import { decrypt } from "@/lib/crypto";
import { plaid } from "@/lib/plaid/client";

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const names = args.filter((a) => !a.startsWith("--"));

  const everything = await getAllItems();

  if (!all && names.length === 0) {
    console.log("Items currently linked (dry-run — pass names or --all to remove):\n");
    for (const it of everything) {
      console.log(`  ${it.institutionName.padEnd(28)} id=${it.id}  plaid=${it.plaidItemId}`);
    }
    console.log("\nExample: npx tsx scripts/remove-item.ts Chase");
    process.exit(0);
  }

  const targets = all
    ? everything
    : everything.filter((it) =>
        names.some((n) => it.institutionName.toLowerCase().includes(n.toLowerCase())),
      );

  if (targets.length === 0) {
    console.log("No items matched. Nothing removed.");
    process.exit(0);
  }

  console.log(`Removing ${targets.length} item(s):\n`);
  for (const it of targets) {
    let plaidStatus = "ok";
    try {
      await plaid().itemRemove({ access_token: decrypt(it.accessTokenEnc) });
    } catch (err) {
      // If the token is already invalid Plaid returns an error — still drop
      // the local row so it can be re-linked cleanly.
      const e = err as { response?: { data?: { error_code?: string } }; message?: string };
      plaidStatus = `plaid /item/remove failed (${e?.response?.data?.error_code ?? e?.message ?? String(err)}) — deleting local row anyway`;
    }
    await db.delete(items).where(eq(items.id, it.id));
    console.log(`  ✓ ${it.institutionName.padEnd(28)} [${plaidStatus}]`);
  }

  console.log(
    "\nDone. Now open the Connections page and click \"Connect an account\" for each\n" +
      "institution to re-link fresh (this backfills up to ~2 years of history).",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
