/**
 * Manual sync runner (no server required).
 * Run: npm run sync
 */
import "dotenv/config";
import { syncAllItems } from "@/lib/plaid/sync";
import { seedCards } from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";

async function main() {
  const results = await syncAllItems();
  for (const r of results) {
    const status = r.error ? `ERROR: ${r.error}` : "ok";
    console.log(
      `${r.institution} (${r.itemId}): +${r.added} ~${r.modified} -${r.removed} ` +
        `accounts=${r.accounts} holdings=${r.holdings} [${status}]`,
    );
  }
  await seedCards();
  const { updated } = await recomputeAndPersist();
  console.log(`Rewards: computed optimal card + delta for ${updated} purchases.`);
  process.exit(results.some((r) => r.error) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
