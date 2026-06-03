import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import {
  spendingDrilldown,
  spendingByMonth,
  spendingByAccount,
  listAccountsForFilter,
  type CategoryDrilldown,
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

  const [drill, byMonth, byAccount, accountOpts] = await Promise.all([
    spendingDrilldown(filter),
    spendingByMonth(filter),
    spendingByAccount(filter),
    listAccountsForFilter(),
  ]);

  const total = drill.totalCents;
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.totalCents));

  // Deep link into the filtered transactions list for a category.
  function txnHref(category: string): string {
    const p = new URLSearchParams();
    p.set("category", category);
    if (f.accountId) p.set("account", f.accountId);
    if (f.from) p.set("from", f.from.toISOString().slice(0, 10));
    if (f.to) p.set("to", f.to.toISOString().slice(0, 10));
    return `/transactions?${p.toString()}`;
  }

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

      <section className="mb-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          By category — click to expand
        </h3>
        {drill.categories.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {drill.categories.map((c) => (
              <CategoryRow key={c.category} c={c} total={total} txnHref={txnHref(c.category)} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
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

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat
    ? "text-zinc-500"
    : up
      ? "text-red-600 dark:text-red-400"
      : "text-green-700 dark:text-green-400";
  return (
    <span className={`text-xs tabular-nums ${color}`} title="vs previous period">
      {flat ? "—" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`}
    </span>
  );
}

/** Collapsible category row: bar + total, expands to subcategories, top
 *  merchants, trend, and a deep link to the filtered transaction list. */
function CategoryRow({
  c,
  total,
  txnHref,
}: {
  c: CategoryDrilldown;
  total: number;
  txnHref: string;
}) {
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
          <span className="text-zinc-400 transition-transform group-open:rotate-90">▶</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {humanizeCategory(c.category)}
                <Trend pct={c.trendPct} />
              </span>
              <span className="tabular-nums">
                {formatCents(c.totalCents)}
                <span className="ml-2 text-xs text-zinc-400">{c.pct}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
                style={{ width: `${total ? (c.totalCents / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </summary>

        <div className="grid grid-cols-1 gap-6 border-t border-zinc-100 px-4 py-4 sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Subcategories
            </h4>
            <table className="w-full text-sm">
              <tbody>
                {c.detailed.map((d) => (
                  <tr key={d.detailed} className="border-t border-zinc-50 dark:border-zinc-900">
                    <td className="py-1">{humanizeDetailed(d.detailed, c.category)}</td>
                    <td className="py-1 text-right text-zinc-500">{d.count}</td>
                    <td className="py-1 text-right tabular-nums">{formatCents(d.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Top merchants
            </h4>
            <table className="w-full text-sm">
              <tbody>
                {c.topMerchants.map((m) => (
                  <tr key={m.merchant} className="border-t border-zinc-50 dark:border-zinc-900">
                    <td className="py-1 truncate">{m.merchant}</td>
                    <td className="py-1 text-right text-zinc-500">{m.count}</td>
                    <td className="py-1 text-right tabular-nums">{formatCents(m.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {c.count} transactions
              {c.prevCents !== null ? ` · previous period ${formatCents(c.prevCents)}` : ""}
            </span>
            <Link href={txnHref} className="font-medium text-foreground hover:underline">
              View transactions →
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}

/** Humanize a pfc_detailed code, stripping the primary prefix when present.
 *  e.g. ("FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK") -> "Restaurant". */
function humanizeDetailed(detailed: string, primary: string): string {
  const tail =
    detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed;
  return humanizeCategory(tail);
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
