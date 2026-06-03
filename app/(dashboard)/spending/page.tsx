import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import {
  spendingByCategory,
  spendingByMonth,
  spendingByAccount,
  listAccountsForFilter,
} from "@/lib/db/analytics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

export const dynamic = "force-dynamic";

export default async function SpendingPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const f = parseFilters(await props.searchParams);
  const filter = { from: f.from, to: f.to, accountId: f.accountId };

  const [byCategory, byMonth, byAccount, accountOpts] = await Promise.all([
    spendingByCategory(filter),
    spendingByMonth(filter),
    spendingByAccount(filter),
    listAccountsForFilter(),
  ]);

  const total = byCategory.reduce((n, c) => n + c.totalCents, 0);
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.totalCents));

  return (
    <PageShell title="Spending" subtitle="By category, month, and account. Outflows only.">
      <FilterBar accounts={accountOpts.map((a) => ({ value: a.id, label: a.name }))} />

      <div className="mb-6 text-sm text-zinc-500">
        Total spending in range: <span className="font-medium text-foreground">{formatCents(total)}</span>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            By category
          </h3>
          {byCategory.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex justify-between text-sm">
                    <span>{humanizeCategory(c.category)}</span>
                    <span className="tabular-nums">{formatCents(c.totalCents)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
                      style={{ width: `${total ? (c.totalCents / total) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            By month
          </h3>
          {byMonth.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {byMonth.map((m) => (
                <li key={m.month}>
                  <div className="flex justify-between text-sm">
                    <span>{m.month}</span>
                    <span className="tabular-nums">{formatCents(m.totalCents)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
                      style={{ width: `${(m.totalCents / maxMonth) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            By account
          </h3>
          {byAccount.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byAccount.map((a) => (
                  <tr key={a.accountId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2">{a.name}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(a.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function Empty() {
  return <p className="text-sm text-zinc-500">No spending in this range.</p>;
}
