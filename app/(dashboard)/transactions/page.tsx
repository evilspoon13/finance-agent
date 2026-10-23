import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import { TransactionList } from "@/components/TransactionList";
import {
  listTransactions,
  countTransactions,
  listAccountsForFilter,
  spendingByCategory,
} from "@/lib/db/analytics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
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
      subtitle={total === 0 ? "No matching transactions." : `Showing ${firstRow}–${lastRow} of ${total}. Tap one to recategorize it.`}
    >
      <FilterBar
        showSearch
        accounts={accountOpts.map((a) => ({ value: a.id, label: a.name }))}
        categories={categoryRows.map((c) => ({
          value: c.category,
          label: humanizeCategory(c.category),
        }))}
      />

      <TransactionList rows={rows} />

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
