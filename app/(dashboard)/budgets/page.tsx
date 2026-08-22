import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { FilterBar } from "@/components/FilterBar";
import { listBudgets } from "@/lib/db/budget-queries";
import {
  spendingDrilldown,
  listAccountsForFilter,
  peerToPeerNet,
  excludedSummary,
  amortizedCharges,
  type DetailedSpend,
  type MerchantSpend,
  type AmortizedCharge,
} from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";
import { createBudgetAction, updateBudgetAction, deleteBudgetAction } from "./actions";

export const dynamic = "force-dynamic";

const BUDGETABLE = new Set<string>(BUDGETABLE_CATEGORIES);

/** A single category as it appears in the unified month view. */
interface Row {
  category: string;
  spentCents: number;
  count: number;
  limitCents: number | null; // null = no budget set
  budgetId: string | null;
  detailed: DetailedSpend[];
  topMerchants: MerchantSpend[];
  trendPct: number | null;
  budgetable: boolean; // can a budget be set for it?
  tag?: string; // overrides the "No budget"/"Not budgetable" chip
  noTxnLink?: boolean; // synthetic rows (P2P) have no category-filtered txn view
  reviewHref?: string; // P2P card links to the categorize screen instead
  amortized: AmortizedCharge[]; // lump premiums this month is only paying a share of
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse ?month=YYYY-MM into a 0-based {year, month}; default current month (UTC). */
function parseMonth(raw: string | undefined, now: Date): { year: number; month: number } {
  const m = raw?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month >= 0 && month <= 11) return { year, month };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default async function BudgetsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const now = new Date();
  const { year, month } = parseMonth(firstParam(sp.month), now);
  const accountId = firstParam(sp.account);

  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth();
  const isFutureMonth =
    year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month > now.getUTCMonth());

  const monthLabel = from.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const [drill, budgets, accountOpts, p2p, excluded, amortized] = await Promise.all([
    spendingDrilldown({ from, to, accountId }),
    listBudgets(),
    listAccountsForFilter(),
    peerToPeerNet({ from, to, accountId }),
    excludedSummary({ from, to, accountId }),
    amortizedCharges({ from, to, accountId }),
  ]);

  const amortizedByCat = new Map<string, AmortizedCharge[]>();
  for (const a of amortized) {
    amortizedByCat.set(a.category, [...(amortizedByCat.get(a.category) ?? []), a]);
  }

  // ── Merge spend (every category) with budgets (limits) into one card list ──
  const budgetByCat = new Map(budgets.map((b) => [b.category, b]));
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const c of drill.categories) {
    const b = budgetByCat.get(c.category);
    rows.push({
      category: c.category,
      spentCents: c.totalCents,
      count: c.count,
      limitCents: b ? b.monthlyLimitCents : null,
      budgetId: b ? b.id : null,
      detailed: c.detailed,
      topMerchants: c.topMerchants,
      trendPct: c.trendPct,
      budgetable: BUDGETABLE.has(c.category),
      amortized: amortizedByCat.get(c.category) ?? [],
    });
    seen.add(c.category);
  }
  // Budgeted categories with no spend this month still show (under budget at $0).
  for (const b of budgets) {
    if (seen.has(b.category)) continue;
    rows.push({
      category: b.category,
      spentCents: 0,
      count: 0,
      limitCents: b.monthlyLimitCents,
      budgetId: b.id,
      detailed: [],
      topMerchants: [],
      trendPct: null,
      budgetable: true,
      amortized: amortizedByCat.get(b.category) ?? [],
    });
  }
  // Net peer-to-peer (Venmo/Zelle/CashApp): sent minus reimbursements. Shown as
  // its own card so this real spending isn't invisible, but it can't be split by
  // category (we don't know what each transfer was for) so it's not budgetable.
  const p2pActive = p2p.outCount > 0 || p2p.inCount > 0;
  const p2pSpend = Math.max(0, p2p.netCents);
  if (p2pActive) {
    rows.push({
      category: "PEER_TO_PEER",
      spentCents: p2pSpend,
      count: p2p.outCount + p2p.inCount,
      limitCents: null,
      budgetId: null,
      detailed: [
        { detailed: "Sent", totalCents: p2p.outCents, count: p2p.outCount },
        { detailed: "Received (reimbursements)", totalCents: p2p.inCents, count: p2p.inCount },
      ],
      topMerchants: p2p.transactions
        .slice(0, 8)
        .map((tx) => ({ merchant: tx.name, totalCents: tx.amountCents, count: 1 })),
      trendPct: null,
      budgetable: false,
      tag: "Uncategorized — net of reimbursements",
      noTxnLink: true,
      reviewHref: "/review",
      amortized: [],
    });
  }

  // Budgeted first, then by spend — "everything by budget", with the rest below.
  rows.sort((a, b) => {
    const a0 = a.limitCents != null ? 0 : 1;
    const b0 = b.limitCents != null ? 0 : 1;
    if (a0 !== b0) return a0 - b0;
    return b.spentCents - a.spentCents;
  });

  const totalSpent = drill.totalCents + p2pSpend;
  const totalBudget = budgets.reduce((s, b) => s + b.monthlyLimitCents, 0);
  const budgetedSpent = rows
    .filter((r) => r.limitCents != null)
    .reduce((s, r) => s + r.spentCents, 0);
  const unbudgetedSpent = totalSpent - budgetedSpent;

  // Budgetable categories with neither spend nor a budget — offered in the
  // bottom "add a budget" picker so you can plan ahead.
  const present = new Set(rows.map((r) => r.category));
  const addable = BUDGETABLE_CATEGORIES.filter((c) => !budgetByCat.has(c) && !present.has(c));

  const daysRemaining = isCurrentMonth
    ? new Date(Date.UTC(year, month + 1, 0)).getUTCDate() - now.getUTCDate()
    : 0;

  function navHref(y: number, mo: number): string {
    const p = new URLSearchParams();
    p.set("month", monthKey(y, mo));
    if (accountId) p.set("account", accountId);
    return `/budgets?${p.toString()}`;
  }

  function txnHref(category: string): string {
    const p = new URLSearchParams();
    p.set("category", category);
    if (accountId) p.set("account", accountId);
    p.set("from", from.toISOString().slice(0, 10));
    p.set("to", to.toISOString().slice(0, 10));
    return `/transactions?${p.toString()}`;
  }

  const prev = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
  const next = month === 11 ? { y: year + 1, m: 0 } : { y: year, m: month + 1 };

  return (
    <PageShell
      title="Budgets"
      subtitle="Each category vs its monthly budget, with the full spending breakdown. Switch months to see how you did."
    >
      {/* ── Month navigator + summary ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            href={navHref(prev.y, prev.m)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Previous month"
          >
            ◀
          </Link>
          <span className="min-w-[10rem] text-center text-base font-semibold">{monthLabel}</span>
          <Link
            href={navHref(next.y, next.m)}
            className={`rounded-full border px-3 py-1 text-sm ${
              isFutureMonth
                ? "pointer-events-none border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
            aria-label="Next month"
          >
            ▶
          </Link>
          {!isCurrentMonth && !isFutureMonth ? (
            <Link href={navHref(now.getUTCFullYear(), now.getUTCMonth())} className="ml-1 text-xs text-zinc-500 hover:underline">
              This month
            </Link>
          ) : null}
        </div>

        <FilterBar
          accounts={accountOpts.map((a) => ({ value: a.id, label: a.name }))}
          showDates={false}
        />
      </div>

      <div className="mb-6 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span>
            Spent <span className="font-semibold">{formatCents(totalSpent)}</span> this month
          </span>
          <span className="text-zinc-500">
            Against budgets:{" "}
            <span className="font-medium text-foreground">{formatCents(budgetedSpent)}</span> /{" "}
            {formatCents(totalBudget)}
          </span>
          {unbudgetedSpent > 0 ? (
            <span className="text-zinc-500">
              Unbudgeted: <span className="font-medium text-foreground">{formatCents(unbudgetedSpent)}</span>
            </span>
          ) : null}
          {isCurrentMonth ? <span className="text-xs text-zinc-400">{daysRemaining} days left</span> : null}
        </div>
      </div>

      {/* ── Unified category cards ── */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No spending in {monthLabel}.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <CategoryCard
              key={r.category}
              r={r}
              isCurrentMonth={isCurrentMonth}
              daysRemaining={daysRemaining}
              txnHref={r.noTxnLink ? "" : txnHref(r.category)}
            />
          ))}
        </ul>
      )}

      {/* ── Plan ahead: add a budget for a category with no activity yet ── */}
      {addable.length > 0 ? (
        <form action={createBudgetAction} className="mt-8 flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <span className="w-full text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Add a budget for another category
          </span>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Category
            <select name="category" required className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700">
              {addable.map((c) => (
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
          <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Add budget
          </button>
        </form>
      ) : null}

      {/* ── Reconciliation: every other dollar that moved, so nothing is hidden ── */}
      <div className="mt-10 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="mb-2 font-semibold uppercase tracking-wide text-zinc-400">
          Where the rest of {monthLabel}&rsquo;s money went (not counted as spending)
        </p>
        <ul className="space-y-1">
          {p2pActive ? (
            <li className="flex justify-between">
              <span>
                Peer-to-peer is counted net above: sent {formatCents(p2p.outCents)} − received{" "}
                {formatCents(-p2p.inCents)} = <span className="text-foreground">{formatCents(p2p.netCents)}</span>
              </span>
            </li>
          ) : null}
          <li className="flex justify-between">
            <span>Internal transfers (to savings &amp; investments)</span>
            <span className="tabular-nums">{formatCents(excluded.internalTransfersCents)}</span>
          </li>
          <li className="flex justify-between">
            <span>Credit-card payments (already counted on the cards)</span>
            <span className="tabular-nums">{formatCents(excluded.ccPaymentsCents)}</span>
          </li>
          <li className="flex justify-between">
            <span>Money in (income, refunds, deposits)</span>
            <span className="tabular-nums">{formatCents(excluded.inflowsCents)}</span>
          </li>
          {excluded.ignoredCents !== 0 ? (
            <li className="flex justify-between">
              <span>Marked &ldquo;not spending&rdquo; by you</span>
              <span className="tabular-nums">{formatCents(excluded.ignoredCents)}</span>
            </li>
          ) : null}
          {excluded.deferredCents !== 0 ? (
            <li className="flex justify-between">
              <span>
                {excluded.deferredCents > 0
                  ? "Premiums paid now, budgeted to later months"
                  : "Premium paid in an earlier month, budgeted to this one"}
              </span>
              <span className="tabular-nums">{formatCents(excluded.deferredCents)}</span>
            </li>
          ) : null}
        </ul>
      </div>
    </PageShell>
  );
}

/** One category card: budget progress (or spend-only) header + expandable breakdown. */
function CategoryCard({
  r,
  isCurrentMonth,
  daysRemaining,
  txnHref,
}: {
  r: Row;
  isCurrentMonth: boolean;
  daysRemaining: number;
  txnHref: string;
}) {
  const hasBudget = r.limitCents != null;
  const over = hasBudget && r.spentCents > (r.limitCents ?? 0);
  const pct = hasBudget && r.limitCents! > 0 ? Math.round((r.spentCents / r.limitCents!) * 100) : 0;
  const barPct = hasBudget ? Math.min(100, pct) : 0;
  const hasBreakdown = r.detailed.length > 0 || r.topMerchants.length > 0;

  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium">
              <span className="text-zinc-400 transition-transform group-open:rotate-90">▶</span>
              {humanizeCategory(r.category)}
              {r.amortized.length > 0 ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-normal text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
                  Premium spread monthly
                </span>
              ) : null}
              {!hasBudget ? (
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-normal text-zinc-400 dark:border-zinc-700">
                  {r.tag ?? (r.budgetable ? "No budget" : "Not budgetable")}
                </span>
              ) : null}
              <Trend pct={r.trendPct} />
            </span>
            <span className={`text-sm tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
              {hasBudget ? (
                <>
                  {formatCents(r.spentCents)} / {formatCents(r.limitCents!)} ({pct}%)
                </>
              ) : (
                formatCents(r.spentCents)
              )}
            </span>
          </div>
          <div className="ml-6 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-2 rounded-full ${
                over ? "bg-red-500" : hasBudget ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
              style={{ width: `${hasBudget ? barPct : 100}%` }}
            />
          </div>
        </summary>

        {/* Breakdown + budget controls */}
        <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          {r.amortized.length > 0 ? (
            <div className="mb-4 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
              <p className="mb-1 font-semibold">Paid up front, budgeted monthly</p>
              <ul className="space-y-0.5">
                {r.amortized.map((a) => (
                  <li key={`${a.merchant}-${a.postedAt?.toISOString() ?? ""}`}>
                    {a.merchant}: <span className="tabular-nums">{formatCents(a.windowCents)}</span> this month —
                    month {a.monthIndex} of {a.months} of a{" "}
                    <span className="tabular-nums">{formatCents(a.totalCents)}</span> {a.months}-month premium
                    {a.postedAt
                      ? ` paid ${a.postedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasBreakdown ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Subcategories</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {r.detailed.map((d) => (
                      <tr key={d.detailed} className="border-t border-zinc-50 dark:border-zinc-900">
                        <td className="py-1">{humanizeDetailed(d.detailed, r.category)}</td>
                        <td className="py-1 text-right text-zinc-500">{d.count}</td>
                        <td className="py-1 text-right tabular-nums">{formatCents(d.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Top merchants</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {r.topMerchants.map((m, i) => (
                      <tr key={`${m.merchant}-${i}`} className="border-t border-zinc-50 dark:border-zinc-900">
                        <td className="py-1 truncate">{m.merchant}</td>
                        <td className="py-1 text-right text-zinc-500">{m.count}</td>
                        <td className="py-1 text-right tabular-nums">{formatCents(m.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No spending in this category this month.</p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>
              {r.count} transaction{r.count === 1 ? "" : "s"}
              {isCurrentMonth && hasBudget ? ` · ${daysRemaining} days left` : ""}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {hasBudget ? (
                <>
                  <form action={updateBudgetAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={r.budgetId!} />
                    <input
                      name="limitDollars"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={Math.round((r.limitCents ?? 0) / 100)}
                      className="w-20 rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
                    />
                    <button type="submit" className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                      Update
                    </button>
                  </form>
                  <form action={deleteBudgetAction}>
                    <input type="hidden" name="id" value={r.budgetId!} />
                    <button type="submit" className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800">
                      Delete
                    </button>
                  </form>
                </>
              ) : r.budgetable ? (
                <form action={createBudgetAction} className="flex items-center gap-1">
                  <input type="hidden" name="category" value={r.category} />
                  <input
                    name="limitDollars"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="limit $"
                    required
                    className="w-24 rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
                  />
                  <button type="submit" className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                    Set budget
                  </button>
                </form>
              ) : null}
              {r.reviewHref ? (
                <Link href={r.reviewHref} className="font-medium text-foreground hover:underline">
                  Categorize these →
                </Link>
              ) : null}
              {txnHref ? (
                <Link href={txnHref} className="font-medium text-foreground hover:underline">
                  View transactions →
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </li>
  );
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
    <span className={`text-xs font-normal tabular-nums ${color}`} title="vs previous month">
      {flat ? "—" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`}
    </span>
  );
}

/** Humanize a pfc_detailed code, stripping the primary prefix when present.
 *  e.g. ("FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK") -> "Restaurant". */
function humanizeDetailed(detailed: string, primary: string): string {
  const tail = detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed;
  return humanizeCategory(tail);
}
