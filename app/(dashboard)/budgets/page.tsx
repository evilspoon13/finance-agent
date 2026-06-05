import { PageShell } from "@/components/PageShell";
import { BudgetAdvisor } from "@/components/BudgetAdvisor";
import { budgetProgress, listBudgets } from "@/lib/db/budget-queries";
import { formatCents } from "@/lib/money";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";
import { createBudgetAction, updateBudgetAction, deleteBudgetAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const [progress, existing] = await Promise.all([budgetProgress(), listBudgets()]);
  const used = new Set(existing.map((b) => b.category));
  const available = BUDGETABLE_CATEGORIES.filter((c) => !used.has(c));

  return (
    <PageShell title="Budgets" subtitle="Per-category monthly limits and current-month progress.">
      <BudgetAdvisor />

      {available.length > 0 ? (
        <form action={createBudgetAction} className="mb-8 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Category
            <select name="category" required className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700">
              {available.map((c) => (
                <option key={c} value={c}>
                  {humanizeCategory(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Monthly limit ($)
            <input
              name="limitDollars"
              type="number"
              min="1"
              step="1"
              required
              className="w-32 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Add budget
          </button>
        </form>
      ) : null}

      {progress.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No budgets yet. Add one above.
        </p>
      ) : (
        <ul className="space-y-4">
          {progress.map((b) => {
            const over = b.spentCents > b.monthlyLimitCents;
            const barPct = Math.min(100, b.pct);
            return (
              <li key={b.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{humanizeCategory(b.category)}</span>
                  <span className={`text-sm tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                    {formatCents(b.spentCents)} / {formatCents(b.monthlyLimitCents)} ({b.pct}%)
                  </span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-2 rounded-full ${over ? "bg-red-500" : "bg-zinc-900 dark:bg-zinc-100"}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                  <span>{b.daysRemaining} days left this month</span>
                  <div className="flex items-center gap-2">
                    <form action={updateBudgetAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={b.id} />
                      <input
                        name="limitDollars"
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={Math.round(b.monthlyLimitCents / 100)}
                        className="w-20 rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
                      />
                      <button type="submit" className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                        Update
                      </button>
                    </form>
                    <form action={deleteBudgetAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <button type="submit" className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
