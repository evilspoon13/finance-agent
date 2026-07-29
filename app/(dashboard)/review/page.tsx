import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { listUncategorizedP2P } from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";
import { categorizeP2PAction, ignoreP2PAction } from "./actions";

export const dynamic = "force-dynamic";

/** Categorize peer-to-peer app payments (Venmo/Zelle/CashApp) so they count
 *  against real budgets instead of hiding in a lump "peer-to-peer" bucket. */
export default async function ReviewPage() {
  const payments = await listUncategorizedP2P();

  return (
    <PageShell
      title="Categorize app payments"
      subtitle="Venmo, Zelle, and Cash App payments arrive without a category. Tag each one so it counts against the right budget — rent, car payment, dining, and so on."
    >
      {payments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500">
            You&rsquo;re all caught up — no app payments waiting to be categorized.
          </p>
          <Link
            href="/budgets"
            className="mt-4 inline-block text-sm font-medium text-foreground hover:underline"
          >
            Back to budgets →
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-zinc-500">
            {payments.length} payment{payments.length === 1 ? "" : "s"} to review.
          </p>
          <ul className="space-y-3">
            {payments.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums font-semibold">{formatCents(p.amountCents)}</span>
                </div>
                <div className="mb-3 text-xs text-zinc-500">
                  {p.postedAt
                    ? p.postedAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })
                    : "—"}{" "}
                  · {p.accountName}
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <form
                    action={categorizeP2PAction}
                    className="flex flex-1 flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={p.id} />
                    <label className="flex flex-col gap-1 text-xs text-zinc-500">
                      Category
                      <select
                        name="category"
                        required
                        defaultValue=""
                        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {BUDGETABLE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {humanizeCategory(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
                      Note (optional)
                      <input
                        name="memo"
                        type="text"
                        maxLength={120}
                        placeholder="e.g. rent, car payment"
                        className="min-w-[8rem] rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      Save
                    </button>
                  </form>
                  <form action={ignoreP2PAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700"
                      title="Not spending — hide from this list"
                    >
                      Not spending
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}
