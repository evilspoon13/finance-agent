import { PageShell } from "@/components/PageShell";
import { listRules } from "@/lib/db/rules-queries";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";
import { createRuleAction, deleteRuleAction } from "./actions";

export const dynamic = "force-dynamic";

const ruleCategoryLabel = (c: string) => (c === "IGNORE" ? "Not spending" : humanizeCategory(c));

export default async function SettingsPage() {
  const rules = await listRules();

  return (
    <PageShell title="Settings">
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Category rules</h3>
          <p className="text-sm text-zinc-500">
            Any transaction whose merchant or description contains the text gets the category — now and on every
            future sync. A category you set on a single transaction always wins over a rule. Use &ldquo;Not
            spending&rdquo; for money moving between your own accounts.
          </p>
        </div>

        <form
          action={createRuleAction}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-zinc-500">
            Merchant contains
            <input
              name="match"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Landlord LLC"
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base text-foreground sm:text-sm dark:border-zinc-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Category
            <select
              name="category"
              required
              defaultValue=""
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base text-foreground sm:text-sm dark:border-zinc-700"
            >
              <option value="" disabled>
                Choose…
              </option>
              {BUDGETABLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanizeCategory(c)}
                </option>
              ))}
              <option value="IGNORE">Not spending</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Add rule
          </button>
        </form>

        {rules.length === 0 ? (
          <p className="text-sm text-zinc-500">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">&ldquo;{r.match}&rdquo;</span>
                  <span className="text-zinc-500"> → {ruleCategoryLabel(r.category)}</span>
                </span>
                <form action={deleteRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="text-xs text-red-600 hover:underline dark:text-red-400">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
