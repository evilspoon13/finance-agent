/**
 * Seed Cam's San Diego monthly budget (built collaboratively).
 * Idempotent — upserts by category, so re-running just updates the limits.
 * Run: npx tsx scripts/seed-budget.ts
 */
import "dotenv/config";
import { upsertBudget, listBudgets, deleteBudget } from "@/lib/db/budget-queries";

// Monthly limits in whole dollars, keyed by Plaid PFC primary code.
// v2 (2026-09-30): re-tuned to September 2026, the first full non-move-in
// month in San Diego, rounded up a little for headroom.
const BUDGET: Record<string, number> = {
  // Rent $2,130 + AT&T ~$31 + SDG&E (only $9 in Sept; room for winter bills).
  RENT_AND_UTILITIES: 2250,
  // ~$357 groceries, ~$285 restaurants/fast food, ~$147 bars (Sept: $840).
  FOOD_AND_DRINK: 850,
  // Gas + the odd Lyft (Sept: $130). No car payment.
  TRANSPORTATION: 175,
  // Set aside for trips; lumpy, so not tuned to one month.
  TRAVEL: 250,
  GENERAL_MERCHANDISE: 275,
  ENTERTAINMENT: 100,
  // Woo Yoga in Sept ($97) was a one-time purchase.
  PERSONAL_CARE: 120,
  // Auto ($414.88 semi-annual = $69.15/mo) + renters ($287.64 annual =
  // $23.97/mo), spread monthly by `amortize_months` → $93.12/mo of known fixed
  // cost. Drops to ~$83/mo if the duplicate Assurant charge gets refunded.
  INSURANCE: 95,
  // UOJ jiu jitsu $205.26/mo (Plaid files it GENERAL_SERVICES_EDUCATION) +
  // Claude subscription $21.90/mo, plus a little headroom.
  GENERAL_SERVICES: 250,
  MEDICAL: 60,
};

/** Categories dropped from the budget — deleted if present so re-runs converge. */
const REMOVED = ["HOME_IMPROVEMENT", "GOVERNMENT_AND_NON_PROFIT"];

async function main() {
  for (const [category, dollars] of Object.entries(BUDGET)) {
    await upsertBudget(category, dollars * 100);
  }
  for (const b of await listBudgets()) {
    if (REMOVED.includes(b.category)) await deleteBudget(b.id);
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
