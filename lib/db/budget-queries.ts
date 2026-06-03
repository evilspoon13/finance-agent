import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./client";
import { budgets, transactions, type Budget } from "./schema";

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

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysRemainingInMonth(d: Date): number {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return end - d.getDate();
}

export async function budgetProgress(now = new Date()): Promise<BudgetProgress[]> {
  const all = await listBudgets();
  if (all.length === 0) return [];

  const from = startOfMonth(now);
  // Spend per pfc_primary for the current month (purchases only).
  const rows = await db
    .select({
      category: transactions.pfcPrimary,
      total: sql<number>`sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.amountCents} > 0`,
        eq(transactions.pending, false),
        sql`${transactions.postedAt} >= ${from}`,
        sql`coalesce(${transactions.pfcPrimary}, '') not in ('TRANSFER_IN', 'TRANSFER_OUT')`,
        sql`coalesce(${transactions.pfcDetailed}, '') <> 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'`,
      ),
    )
    .groupBy(transactions.pfcPrimary);

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
