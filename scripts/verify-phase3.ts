/**
 * Phase 3 analytics check (uses whatever is already in the DB, e.g. the Sandbox
 * data from verify-phase2). Prints net worth, spending breakdowns, and a
 * transaction sample so the dashboard query layer can be eyeballed without a
 * browser.
 *
 * Run: npm run verify:phase3
 */
import "dotenv/config";
import {
  getNetWorth,
  spendingByCategory,
  spendingByMonth,
  spendingByAccount,
  listTransactions,
} from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

async function main() {
  const nw = await getNetWorth();
  console.log("=== Net Worth ===");
  console.log(`  Assets:      ${formatCents(nw.assetsCents)}`);
  console.log(`  Liabilities: ${formatCents(-nw.liabilitiesCents)}`);
  console.log(`  Net worth:   ${formatCents(nw.netWorthCents)}`);
  console.log(`  (${nw.lines.length} accounts)`);

  console.log("\n=== Spending by category ===");
  for (const c of (await spendingByCategory()).slice(0, 8)) {
    console.log(`  ${humanizeCategory(c.category).padEnd(28)} ${formatCents(c.totalCents)} (${c.count})`);
  }

  console.log("\n=== Spending by month ===");
  for (const m of await spendingByMonth()) {
    console.log(`  ${m.month}  ${formatCents(m.totalCents)}`);
  }

  console.log("\n=== Spending by account ===");
  for (const a of await spendingByAccount()) {
    console.log(`  ${a.name.padEnd(28)} ${formatCents(a.totalCents)}`);
  }

  console.log("\n=== Recent transactions (10) ===");
  for (const t of await listTransactions({ limit: 10 })) {
    const date = t.postedAt ? t.postedAt.toISOString().slice(0, 10) : "----------";
    const label = (t.merchantName ?? t.name).slice(0, 30).padEnd(30);
    console.log(`  ${date}  ${label} ${formatCents(-t.amountCents)}`);
  }

  console.log("\nPHASE 3 query layer OK ✅");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
