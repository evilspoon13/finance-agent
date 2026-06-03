import Link from "next/link";
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

      <RangePresets account={f.accountId} />

      <div className="mb-6 text-sm text-zinc-500">
        {f.from || f.to ? (
          <>
            Range: {f.from ? f.from.toISOString().slice(0, 10) : "earliest"} —{" "}
            {f.to ? f.to.toISOString().slice(0, 10) : "today"}.{" "}
          </>
        ) : (
          <>Range: all time. </>
        )}
        Total spending: <span className="font-medium text-foreground">{formatCents(total)}</span>
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

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Quick date-range presets that preserve the account filter. */
function RangePresets({ account }: { account?: string }) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last3 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()));
  const last12 = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));

  const presets: { label: string; from?: string }[] = [
    { label: "This month", from: iso(monthStart) },
    { label: "Last 3 months", from: iso(last3) },
    { label: "Last 12 months", from: iso(last12) },
    { label: "All time" },
  ];

  function href(from?: string): string {
    const p = new URLSearchParams();
    if (account) p.set("account", account);
    if (from) p.set("from", from);
    const qs = p.toString();
    return qs ? `/spending?${qs}` : "/spending";
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2 text-xs">
      {presets.map((p) => (
        <Link
          key={p.label}
          href={href(p.from)}
          className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
