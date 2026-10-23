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
 *  5. Group bills Cam fronted and got paid back for (2026-09-30): the charge
 *     keeps its category but counts only Cam's share via `reimbursed_cents`,
 *     and the friends' incoming Venmo/Zelle are tagged REIMBURSEMENT.
 *  6. Rent paid a day or so early (2026-10-05): budgeted to the month it covers.
 *
 * Run: npx tsx scripts/tune-categories.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { IGNORE_CATEGORY, REIMBURSEMENT_CATEGORY } from "@/lib/db/spend-sql";
import { INSURANCE_CATEGORY } from "@/lib/category";

/** July F&F charges → the August budget month (August lease start). */
const FF_JULY_TO_AUGUST: { id: string; memo: string }[] = [
  { id: "8jZQgrp91NSjL1VraeKZirRBrYdNxgUm5LdEA", memo: "August rent + deposit (paid 2026-07-30)" },
  { id: "PJDD8q563kfMr9j4NAL3HvJqo8PEvwU506NbqO", memo: "Move-in charge (paid 2026-07-24)" },
  { id: "Ndx8QQjgaZFYBZmk6v0KH6eJwk6p3rUoRb8MK", memo: "Move-in fee (paid 2026-07-23)" },
];
/**
 * The month those charges budget under. Set via `budget_month`, NOT by editing
 * posted_at: sync rewrites posted_at from Plaid on every run, so an edit there
 * silently reverts and the rent shows up in July again.
 */
const AUGUST_BUDGET_MONTH = "2026-08-01";

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

/**
 * Fronted group bills. Matched on name + amount + posted date rather than the
 * Plaid ID so a re-link (which issues new transaction IDs) can be re-pinned by
 * re-running this script. Each payback is matched the same way.
 */
const FRONTED_BILLS: {
  name: string;
  amountCents: number;
  postedOn: string;
  ownShareCents: number;
  memo: string;
  paybacks: { name: string; amountCents: number; postedOn: string }[];
}[] = [
  {
    name: "LITTLE SAKANA",
    amountCents: 43727,
    postedOn: "2026-09-13",
    ownShareCents: 5227,
    memo: "Group dinner, fronted the bill; friends paid back $385.00",
    paybacks: [
      { name: "Zelle% from Skyler Lucero", amountCents: -5500, postedOn: "2026-09-11" },
      { name: "Venmo", amountCents: -33000, postedOn: "2026-09-13" },
    ],
  },
];

/**
 * Rent charges paid before the month they cover. Matched like FRONTED_BILLS
 * (name + amount + date) so a re-link can be re-pinned. budget_month, not
 * posted_at — sync rewrites posted_at every run.
 */
const RENT_PAID_EARLY: { amountCents: number; postedOn: string; budgetMonth: string; memo: string }[] = [
  { amountCents: 213023, postedOn: "2026-09-30", budgetMonth: "2026-10-01", memo: "October rent (paid 2026-09-30)" },
];

/** Exact-day match on posted_at (stored UTC), tolerant of name prefixes. */
function matchTxn(name: string, amountCents: number, postedOn: string) {
  return sql`${transactions.name} ilike ${`%${name}%`} and ${transactions.amountCents} = ${amountCents} and ${transactions.postedAt}::date = ${postedOn}::date`;
}

async function main() {
  // 1. F&F Property → rent, in the August budget month.
  for (const { id, memo } of FF_JULY_TO_AUGUST) {
    await db
      .update(transactions)
      .set({ budgetMonth: AUGUST_BUDGET_MONTH, userCategory: "RENT_AND_UTILITIES", userMemo: memo })
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

  // 6. Rent paid ahead: the 2026-09-30 F&F charge is October's rent.
  for (const r of RENT_PAID_EARLY) {
    const hit = await db
      .update(transactions)
      .set({ budgetMonth: r.budgetMonth, userMemo: r.memo })
      .where(matchTxn("F and F Property", r.amountCents, r.postedOn))
      .returning({ id: transactions.id });
    if (hit.length !== 1) console.warn(`Rent ${r.postedOn}: matched ${hit.length} charges (expected 1)`);
  }

  // 5. Fronted group bills: count only Cam's share; tag the paybacks.
  for (const bill of FRONTED_BILLS) {
    const hit = await db
      .update(transactions)
      .set({ reimbursedCents: bill.amountCents - bill.ownShareCents, userMemo: bill.memo })
      .where(matchTxn(bill.name, bill.amountCents, bill.postedOn))
      .returning({ id: transactions.id });
    if (hit.length !== 1) console.warn(`${bill.name}: matched ${hit.length} charges (expected 1)`);
    for (const p of bill.paybacks) {
      const got = await db
        .update(transactions)
        .set({ userCategory: REIMBURSEMENT_CATEGORY, userMemo: `Payback: ${bill.name.toLowerCase()}` })
        .where(matchTxn(p.name, p.amountCents, p.postedOn))
        .returning({ id: transactions.id });
      if (got.length !== 1) console.warn(`${bill.name} payback ${p.name}: matched ${got.length} (expected 1)`);
    }
  }

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      sql`${transactions.userCategory} is not null or ${transactions.amortizeMonths} is not null or ${transactions.reimbursedCents} is not null`,
    );
  console.log(`Done. ${counted?.count ?? 0} transactions now carry a user override.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
