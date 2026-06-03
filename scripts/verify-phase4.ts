/**
 * Phase 4 verification: seed cards from synced accounts, recompute optimal card
 * + reward delta for every purchase, and print the rewards report.
 *
 * Run: npm run verify:phase4
 */
import "dotenv/config";
import { seedCards } from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";
import { budgetProgress } from "@/lib/db/budget-queries";
import { quarterKey, discoverCategoriesFor, MILES_VALUE_CENTS } from "@/lib/rewards/config";
import { humanizeCategory } from "@/lib/category";
import { formatCents } from "@/lib/money";

async function main() {
  console.log("→ Seeding cards from accounts…");
  for (const s of await seedCards()) {
    console.log(`  ${s.label.padEnd(38)} account=${s.accountId ?? "(unlinked!)"}`);
  }

  const now = new Date();
  console.log(
    `\nDiscover ${quarterKey(now)} 5% categories: ${discoverCategoriesFor(now)
      .map((c) => humanizeCategory(c))
      .join(", ") || "(not announced)"} | miles @ ${MILES_VALUE_CENTS}¢`,
  );

  console.log("\n→ Recomputing optimal card + delta…");
  const { updated, report } = await recomputeAndPersist();
  console.log(`  computed for ${updated} purchases`);

  console.log("\n=== Value earned per card ===");
  for (const c of report.perCard) {
    console.log(`  ${c.label.padEnd(38)} ${formatCents(c.earnedCents)} (${c.txnCount})`);
  }
  console.log(`  TOTAL earned: ${formatCents(report.totalEarnedCents)}`);
  console.log(`  TOTAL missed: ${formatCents(report.totalMissedCents)}`);

  console.log("\n=== Which card to use ===");
  for (const g of report.guide) {
    const cat = g.category === "everything else" ? "Everything else" : humanizeCategory(g.category);
    console.log(`  ${cat.padEnd(22)} -> ${g.bestLabel.padEnd(38)} ${(g.effectiveBps / 100).toFixed(2)}%`);
  }

  console.log("\n=== Top missed rewards ===");
  for (const m of report.missed.slice(0, 12)) {
    const date = m.postedAt ? m.postedAt.toISOString().slice(0, 10) : "----------";
    console.log(
      `  ${date}  ${m.label.slice(0, 26).padEnd(26)} ${formatCents(m.amountCents)}  ` +
        `${m.actualLabel} -> ${m.optimalLabel}  +${formatCents(m.deltaCents)}`,
    );
  }

  const budgets = await budgetProgress(now);
  if (budgets.length) {
    console.log("\n=== Budget progress (this month) ===");
    for (const b of budgets) {
      console.log(
        `  ${humanizeCategory(b.category).padEnd(22)} ${formatCents(b.spentCents)} / ${formatCents(
          b.monthlyLimitCents,
        )} (${b.pct}%)`,
      );
    }
  }

  console.log("\nPHASE 4 compute OK ✅");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
