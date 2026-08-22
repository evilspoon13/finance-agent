/**
 * One-off: seed Cam's San Diego v1 monthly budget (built collaboratively).
 * Idempotent — upserts by category, so re-running just updates the limits.
 * Run: npx tsx scripts/seed-budget.ts
 */
import "dotenv/config";
import { upsertBudget, listBudgets } from "@/lib/db/budget-queries";

// Monthly limits in whole dollars, keyed by Plaid PFC primary code.
const BUDGET: Record<string, number> = {
  RENT_AND_UTILITIES: 2450,
  FOOD_AND_DRINK: 700,
  TRANSPORTATION: 350,
  TRAVEL: 250,
  GENERAL_MERCHANDISE: 250,
  ENTERTAINMENT: 200,
  PERSONAL_CARE: 120,
  // Auto ($414.88 semi-annual = $69.15/mo) + renters ($287.64 annual =
  // $23.97/mo), spread monthly by `amortize_months` → $93.12/mo of known fixed
  // cost. Drops to ~$83/mo if the duplicate Assurant charge gets refunded.
  INSURANCE: 95,
  GENERAL_SERVICES: 80,
  MEDICAL: 60,
  HOME_IMPROVEMENT: 50,
  GOVERNMENT_AND_NON_PROFIT: 20,
};

async function main() {
  for (const [category, dollars] of Object.entries(BUDGET)) {
    await upsertBudget(category, dollars * 100);
  }
  const rows = await listBudgets();
  const total = rows.reduce((s, b) => s + b.monthlyLimitCents, 0);
  console.log(`Seeded ${rows.length} budget categories:`);
  for (const b of rows) {
    console.log(`  ${b.category.padEnd(28)} $${(b.monthlyLimitCents / 100).toLocaleString()}`);
  }
  console.log(`  ${"TOTAL".padEnd(28)} $${(total / 100).toLocaleString()}/mo`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
