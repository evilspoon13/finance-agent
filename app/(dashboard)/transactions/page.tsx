import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import { listTransactions, listAccountsForFilter, spendingByCategory } from "@/lib/db/analytics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function TransactionsPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const f = parseFilters(await props.searchParams);

  const [rows, accountOpts, categoryRows] = await Promise.all([
    listTransactions({ ...f, limit: PAGE_SIZE }),
    listAccountsForFilter(),
    spendingByCategory({}),
  ]);

  return (
    <PageShell
      title="Transactions"
      subtitle={`Showing up to ${PAGE_SIZE} most recent matching transactions.`}
    >
      <FilterBar
        showSearch
        accounts={accountOpts.map((a) => ({ value: a.id, label: a.name }))}
        categories={categoryRows.map((c) => ({
          value: c.category,
          label: humanizeCategory(c.category),
        }))}
      />

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Merchant / Name</th>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No matching transactions.
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 whitespace-nowrap text-zinc-500">
                    {t.postedAt ? t.postedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {t.merchantName ?? t.name}
                    {t.pending ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        pending
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{t.accountName}</td>
                  <td className="px-4 py-2 text-zinc-500">{humanizeCategory(t.category)}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      t.amountCents < 0 ? "text-green-700 dark:text-green-400" : ""
                    }`}
                  >
                    {/* Stored positive = outflow; show outflow as negative for the reader. */}
                    {formatCents(-t.amountCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
