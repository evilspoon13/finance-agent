"use client";

import { useState, useTransition } from "react";
import { saveTransactionAction } from "@/app/(dashboard)/transactions/actions";
import type { TxnRow } from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";
import { humanizeCategory, BUDGETABLE_CATEGORIES } from "@/lib/category";

// Mirrors IGNORE_CATEGORY / REIMBURSEMENT_CATEGORY in lib/db/spend-sql (which
// is server-only: it builds SQL).
const IGNORE = "IGNORE";
const REIMBURSEMENT = "REIMBURSEMENT";

function categoryLabel(t: TxnRow): string {
  if (t.userCategory === IGNORE) return "Not spending";
  if (t.userCategory === REIMBURSEMENT) return "Payback";
  return humanizeCategory(t.category);
}

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const hasOverride = (t: TxnRow) =>
  t.userCategory != null || t.budgetMonth != null || t.amortizeMonths != null || t.reimbursedCents != null;

/**
 * The transaction list (a table on wide screens, stacked rows on phones).
 * Tapping a row opens the editor for its overrides.
 */
export function TransactionList({ rows }: { rows: TxnRow[] }) {
  const [editing, setEditing] = useState<TxnRow | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No matching transactions.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="hidden w-full text-sm sm:table">
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
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => setEditing(t)}
                className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <td className="whitespace-nowrap px-4 py-2 text-zinc-500">{date(t.postedAt)}</td>
                <td className="px-4 py-2">
                  <Name t={t} />
                </td>
                <td className="px-4 py-2 text-zinc-500">{t.accountName}</td>
                <td className="px-4 py-2 text-zinc-500">
                  {categoryLabel(t)}
                  {hasOverride(t) ? <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">●</span> : null}
                </td>
                <td className="px-4 py-2 text-right">
                  <Amount t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-zinc-100 sm:hidden dark:divide-zinc-800">
          {rows.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left active:bg-zinc-50 dark:active:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    <Name t={t} />
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {date(t.postedAt)} · {categoryLabel(t)}
                    {hasOverride(t) ? <span className="ml-1 text-blue-600 dark:text-blue-400">●</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-sm">
                  <Amount t={t} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {editing ? <TransactionEditor key={editing.id} t={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function Name({ t }: { t: TxnRow }) {
  return (
    <>
      {t.merchantName ?? t.name}
      {t.pending ? (
        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          pending
        </span>
      ) : null}
    </>
  );
}

function Amount({ t }: { t: TxnRow }) {
  // Stored positive = outflow; show outflow as negative for the reader.
  return (
    <span className={`tabular-nums ${t.amountCents < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
      {formatCents(-t.amountCents)}
    </span>
  );
}

const input = "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base sm:text-sm dark:border-zinc-700";
const label = "mb-1 block text-xs font-medium text-zinc-500";

/** Bottom sheet on phones, centered dialog on wider screens. */
function TransactionEditor({ t, onClose }: { t: TxnRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(t.userCategory ?? "");
  const outflow = t.amountCents > 0;
  const merchant = t.merchantName ?? t.name;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveTransactionAction(formData);
      if (res.ok) onClose();
      else setError(res.error ?? "Couldn't save.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{merchant}</div>
            <div className="text-xs text-zinc-500">
              {date(t.postedAt)} · {t.accountName} · Plaid: {humanizeCategory(t.plaidCategory)}
            </div>
          </div>
          <span className="shrink-0 font-semibold">
            <Amount t={t} />
          </span>
        </div>

        <form action={submit} className="space-y-4">
          <input type="hidden" name="id" value={t.id} />

          <label className="block">
            <span className={label}>Category</span>
            <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
              <option value="">Plaid&apos;s category ({humanizeCategory(t.plaidCategory)})</option>
              {BUDGETABLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanizeCategory(c)}
                </option>
              ))}
              <option value={IGNORE}>Not spending (leave out of budgets)</option>
              {!outflow ? <option value={REIMBURSEMENT}>Payback for a bill I fronted</option> : null}
            </select>
          </label>

          {category ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="ruleMatch" value={merchant} className="mt-1" />
              <span>
                Also use this for every transaction from <strong>{merchant}</strong>
                <span className="block text-xs text-zinc-500">Creates a rule; manage rules in Settings.</span>
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className={label}>Note</span>
            <input name="memo" defaultValue={t.memo ?? ""} maxLength={200} className={input} />
          </label>

          {outflow ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={label}>Count in month</span>
                  <input
                    name="budgetMonth"
                    type="month"
                    defaultValue={t.budgetMonth?.slice(0, 7) ?? ""}
                    className={input}
                  />
                </label>
                <label className="block">
                  <span className={label}>Spread over (months)</span>
                  <input
                    name="amortizeMonths"
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={t.amortizeMonths ?? ""}
                    placeholder="1"
                    className={input}
                  />
                </label>
              </div>
              <label className="block">
                <span className={label}>Others paid back ($)</span>
                <input
                  name="reimbursed"
                  type="number"
                  step="0.01"
                  min={0}
                  max={t.amountCents / 100}
                  defaultValue={t.reimbursedCents ? t.reimbursedCents / 100 : ""}
                  placeholder="0.00"
                  className={input}
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  For a bill you fronted: budgets count only your share.
                </span>
              </label>
            </>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
