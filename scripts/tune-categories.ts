/**
 * One-off corrections to how San Diego move-in spending is categorized, agreed
 * with Cam on 2026-08-16. Idempotent — safe to re-run after a resync or reset.
 *
 * Plaid gets these wrong in ways no generic rule can fix, so they're pinned via
 * `user_category` / `amortize_months`, which sync never overwrites:
 *
 *  1. F&F Property (the landlord) is filed as GENERAL_SERVICES. It's rent. The
 *     three July charges are the August lease (deposit + first month + fees),
 *     so they move to the August budget month where Cam actually lives.
 *  2. Insurance (Progressive auto, Assurant renters) gets its own INSURANCE
 *     budget line and is spread across the 6 months each premium covers.
 *  3. Members Choice Credit Union moves are transfers between Cam's own banks,
 *     not spending. (Also matched structurally by OWN_BANK_MERCHANTS.)
 *  4. Assorted move-in charges Plaid mis-filed (a tenant screening fee booked
 *     as MEDICAL, a storage unit booked as a restaurant).
 *
 * Run: npx tsx scripts/tune-categories.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { IGNORE_CATEGORY } from "@/lib/db/spend-sql";
import { INSURANCE_CATEGORY } from "@/lib/category";

/** July F&F charges → the August budget month (August lease start). */
const FF_JULY_TO_AUGUST: { id: string; memo: string }[] = [
  { id: "8jZQgrp91NSjL1VraeKZirRBrYdNxgUm5LdEA", memo: "August rent + deposit (paid 2026-07-30)" },
  { id: "7AXDYrA0zLHNx563BpqBUdjDQdVqzLI850Opb", memo: "Move-in charge (paid 2026-07-24)" },
  { id: "Ndx8QQjgaZFYBZmk6v0KH6eJwk6p3rUoRb8MK", memo: "Move-in fee (paid 2026-07-23)" },
];
/** Where the moved charges land: Aug 1, so they sit at the start of the month. */
const AUGUST_START = new Date("2026-08-01T12:00:00Z");

/**
 * Premiums Cam pays in full up front, and the term each one covers. Matched by
 * merchant rather than by Plaid's INSURANCE code so a one-off $5 health copay
 * filed under the same code doesn't get spread across a policy term.
 *
 * NOTE: Assurant charged twice on 2026-07-30 — $116.06 (Capital One) and
 * $171.58 (Chase), two different cards, no refund since. Both are spread as
 * real spend; if the first turns out to be an erroneous charge, the refund will
 * land as a credit and this should drop to the $171.58 policy alone.
 */
const PREMIUM_TERMS: { merchant: string; months: number }[] = [
  { merchant: "Progressive", months: 6 }, // auto, semi-annual
  { merchant: "Assurant", months: 12 }, // renters, annual
];

/** Members Choice ↔ SoFi moves between Cam's own banks. */
const OWN_BANK_TRANSFERS_MATCH = "MEMBERS CHOICE CREDIT UNION";

async function main() {
  // 1. F&F Property → rent, in the August budget month.
  for (const { id, memo } of FF_JULY_TO_AUGUST) {
    await db
      .update(transactions)
      .set({ postedAt: AUGUST_START, userCategory: "RENT_AND_UTILITIES", userMemo: memo })
      .where(eq(transactions.id, id));
  }
  // The one F&F charge already in August only needs the category pin.
  await db
    .update(transactions)
    .set({ userCategory: "RENT_AND_UTILITIES" })
    .where(sql`${transactions.name} ilike '%F and F Property%' and ${transactions.userCategory} is null`);

  // 2. Insurance → its own category, each premium spread over its policy term.
  for (const { merchant, months } of PREMIUM_TERMS) {
    await db
      .update(transactions)
      .set({ userCategory: INSURANCE_CATEGORY, amortizeMonths: months })
      .where(
        sql`${transactions.merchantName} ilike ${`%${merchant}%`} and ${transactions.pfcDetailed} = 'GENERAL_SERVICES_INSURANCE'`,
      );
  }

  // 3. Own-bank transfers are not spending.
  await db
    .update(transactions)
    .set({ userCategory: IGNORE_CATEGORY, userMemo: "Transfer between my own banks" })
    .where(
      sql`upper(coalesce(${transactions.merchantName}, '') || ' ' || ${transactions.name}) like ${`%${OWN_BANK_TRANSFERS_MATCH}%`}`,
    );

  // 4. Move-in charges Plaid mis-filed.
  await db
    .update(transactions)
    .set({ userCategory: "RENT_AND_UTILITIES", userMemo: "Tenant screening fee (apartment application)" })
    .where(sql`${transactions.name} ilike '%KEYCHECK SCREENING%'`);
  await db
    .update(transactions)
    .set({ userCategory: "GENERAL_SERVICES", userMemo: "Storage unit (mis-filed as a restaurant)" })
    .where(
      sql`${transactions.name} ilike '%Pss Pacific%' and ${transactions.pfcDetailed} = 'FOOD_AND_DRINK_RESTAURANT'`,
    );

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(sql`${transactions.userCategory} is not null or ${transactions.amortizeMonths} is not null`);
  console.log(`Done. ${counted?.count ?? 0} transactions now carry a user override.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
