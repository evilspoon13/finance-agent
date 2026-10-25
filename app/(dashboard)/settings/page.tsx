import { PageShell } from "@/components/PageShell";
import { listRules } from "@/lib/db/rules-queries";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";
import { getContext, GOALS_KEY, NOTES_KEY } from "@/lib/db/agent-queries";
import { env } from "@/lib/env";
import { createRuleAction, deleteRuleAction, saveGoalsAction, saveNotesAction } from "./actions";

export const dynamic = "force-dynamic";

const ruleCategoryLabel = (c: string) => (c === "IGNORE" ? "Not spending" : humanizeCategory(c));

export default async function SettingsPage() {
  const [rules, goals, notes] = await Promise.all([listRules(), getContext(GOALS_KEY), getContext(NOTES_KEY)]);
  const { AGENT_TOKEN, DATABASE_URL_READONLY } = env();
  const agentReady = Boolean(AGENT_TOKEN && DATABASE_URL_READONLY);

  return (
    <PageShell title="Settings">
      <section className="mb-10 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Goals</h3>
          <p className="text-sm text-zinc-500">
            What your scheduled finance agent measures progress against: savings targets, contribution plans,
            deadlines, rules of thumb. Plain text or markdown. Its reports are on the{" "}
            <a href="/briefings" className="underline">
              Briefings
            </a>{" "}
            page.
          </p>
        </div>
        <form action={saveGoalsAction} className="space-y-2">
          <textarea
            name="goals"
            rows={16}
            defaultValue={goals ?? ""}
            placeholder={"- Save 30% of gross pay\n- Max the Roth IRA by April\n- Keep 6 months of expenses in cash"}
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-base sm:text-sm dark:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save goals
          </button>
        </form>
        <div className="pt-4">
          <h3 className="text-sm font-semibold">Agent notes</h3>
          <p className="text-sm text-zinc-500">
            The agent&apos;s memory between runs: what you&apos;ve told it in replies and what it has already
            explained. It keeps these up to date; edit them to correct something.
          </p>
        </div>
        <form action={saveNotesAction} className="space-y-2">
          <textarea
            name="notes"
            rows={8}
            defaultValue={notes ?? ""}
            placeholder="Empty until the agent's first run."
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-base sm:text-sm dark:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save notes
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          Agent access: {agentReady ? "configured" : "not configured (set AGENT_TOKEN and DATABASE_URL_READONLY)"}
        </p>
      </section>

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
