import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import {
  listTransactions,
  countTransactions,
  listAccountsForFilter,
  spendingByCategory,
} from "@/lib/db/analytics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function pageHref(params: RawSearchParams, page: number): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page") continue;
    if (typeof v === "string" && v) next.set(k, v);
  }
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

export default async function TransactionsPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await props.searchParams;
  const f = parseFilters(raw);
  const page = Math.max(1, Number(Array.isArray(raw.page) ? raw.page[0] : raw.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, total, accountOpts, categoryRows] = await Promise.all([
    listTransactions({ ...f, limit: PAGE_SIZE, offset }),
    countTransactions(f),
    listAccountsForFilter(),
    spendingByCategory({}),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = Math.min(offset + PAGE_SIZE, total);

  return (
    <PageShell
      title="Transactions"
      subtitle={total === 0 ? "No matching transactions." : `Showing ${firstRow}–${lastRow} of ${total}.`}
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

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <PagerLink href={pageHref(raw, page - 1)} disabled={page <= 1}>
            ← Previous
          </PagerLink>
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <PagerLink href={pageHref(raw, page + 1)} disabled={page >= totalPages}>
            Next →
          </PagerLink>
        </div>
      ) : null}
    </PageShell>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls = "rounded-md border px-3 py-1.5 border-zinc-300 dark:border-zinc-700";
  if (disabled) {
    return <span className={`${cls} cursor-not-allowed text-zinc-400`}>{children}</span>;
  }
  return (
    <Link href={href} className={`${cls} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
      {children}
    </Link>
  );
}
