import { randomUUID } from "node:crypto";
import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "./client";
import { budgets, transactions, type Budget } from "./schema";
import { effectiveCategory, spendRowPredicate, windowAmountCents, inWindow } from "./spend-sql";

/**
 * Budget CRUD plus current-month progress (spent vs limit per category).
 * `category` matches transactions.pfc_primary.
 */

export async function listBudgets(): Promise<Budget[]> {
  return db.select().from(budgets).orderBy(budgets.category);
}

export async function createBudget(category: string, monthlyLimitCents: number): Promise<void> {
  await db.insert(budgets).values({ id: randomUUID(), category, monthlyLimitCents });
}

/** Insert or update the budget for a category (category is the natural key). */
export async function upsertBudget(category: string, monthlyLimitCents: number): Promise<void> {
  const existing = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(eq(budgets.category, category))
    .limit(1);
  if (existing[0]) {
    await db.update(budgets).set({ monthlyLimitCents }).where(eq(budgets.id, existing[0].id));
  } else {
    await db.insert(budgets).values({ id: randomUUID(), category, monthlyLimitCents });
  }
}

export async function updateBudget(id: string, monthlyLimitCents: number): Promise<void> {
  await db.update(budgets).set({ monthlyLimitCents }).where(eq(budgets.id, id));
}

export async function deleteBudget(id: string): Promise<void> {
  await db.delete(budgets).where(eq(budgets.id, id));
}

export interface BudgetProgress {
  id: string;
  category: string;
  monthlyLimitCents: number;
  spentCents: number;
  pct: number; // 0..100+ (can exceed 100 when over budget)
  daysRemaining: number;
}

// Months are calendar months in UTC, matching the /budgets page and the
// amortized-slice math in spend-sql (monthIndex uses getUTCMonth). A local-time
// window ends after UTC midnight on the 1st west of UTC, so it spilled into the
// next month and double-counted amortized charges' slices.
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function daysRemainingInMonth(d: Date): number {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return end - d.getUTCDate();
}

export async function budgetProgress(now = new Date()): Promise<BudgetProgress[]> {
  const all = await listBudgets();
  if (all.length === 0) return [];

  const from = startOfMonth(now);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const win = { from, to };
  // Spend per pfc_primary for the current month (purchases only). Amortized
  // charges contribute only this month's slice — see spend-sql.
  const rows = await db
    .select({
      category: effectiveCategory,
      total: sql<number>`sum(${windowAmountCents(win)})::int`,
    })
    .from(transactions)
    .where(
      and(
        gt(transactions.amountCents, 0),
        eq(transactions.pending, false),
        inWindow(win),
        // Purchases plus user-categorized peer-to-peer payments (see spend-sql).
        spendRowPredicate(),
      ),
    )
    .groupBy(effectiveCategory);

  const spentByCat = new Map<string, number>();
  for (const r of rows) if (r.category) spentByCat.set(r.category, r.total ?? 0);

  const days = daysRemainingInMonth(now);
  return all.map((b) => {
    const spent = spentByCat.get(b.category) ?? 0;
    const pct = b.monthlyLimitCents > 0 ? Math.round((spent / b.monthlyLimitCents) * 100) : 0;
    return {
      id: b.id,
      category: b.category,
      monthlyLimitCents: b.monthlyLimitCents,
      spentCents: spent,
      pct,
      daysRemaining: days,
    };
  });
}
