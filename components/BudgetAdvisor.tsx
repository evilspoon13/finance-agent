"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import { Markdown } from "./Markdown";
import { applyBudgetsAction } from "@/app/(dashboard)/budgets/actions";

/** One row of the editable plan. limitDollars is the user-editable string. */
interface PlanRow {
  category: string;
  humanName: string;
  avgMonthlyCents: number;
  limitDollars: string;
  rationale: string;
}

interface ApiPlan {
  incomeCents: number;
  monthsAnalyzed: number;
  totalAvgMonthlyCents: number;
  summary: string;
  suggestions: {
    category: string;
    humanName: string;
    avgMonthlyCents: number;
    limitCents: number;
    rationale: string;
  }[];
}

/**
 * AI budget advisor. Enter monthly take-home income (and an optional steer),
 * get a per-category plan grounded in your recent average spend, edit it, and
 * apply. Runs against the local model via /api/ai/budget-suggest.
 */
export function BudgetAdvisor() {
  const router = useRouter();
  const [income, setIncome] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [incomeCents, setIncomeCents] = useState(0);
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [isApplying, startApply] = useTransition();

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const dollars = Number(income);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter your monthly take-home income.");
      return;
    }
    setLoading(true);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch("/api/ai/budget-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incomeDollars: dollars, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { plan?: ApiPlan; error?: string };
      if (!res.ok || !data.plan) {
        setError(data.error ?? "Failed to generate budget.");
        setRows(null);
        return;
      }
      const plan = data.plan;
      setIncomeCents(plan.incomeCents);
      setSummary(plan.summary);
      setRows(
        plan.suggestions.map((s) => ({
          category: s.category,
          humanName: s.humanName,
          avgMonthlyCents: s.avgMonthlyCents,
          limitDollars: String(Math.round(s.limitCents / 100)),
          rationale: s.rationale,
        })),
      );
    } catch {
      setError("Request failed.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  function setLimit(category: string, value: string) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.category === category ? { ...r, limitDollars: value } : r)) : prev,
    );
    setApplied(null);
  }

  const totalCents = rows
    ? rows.reduce((s, r) => s + Math.max(0, Math.round(Number(r.limitDollars) || 0) * 100), 0)
    : 0;
  const savingsCents = incomeCents - totalCents;

  function apply() {
    if (!rows) return;
    const items = rows
      .map((r) => ({ category: r.category, limitCents: Math.round(Number(r.limitDollars) || 0) * 100 }))
      .filter((i) => i.limitCents > 0);
    if (items.length === 0) {
      setError("Set at least one limit above $0.");
      return;
    }
    setError(null);
    startApply(async () => {
      const result = await applyBudgetsAction(items);
      if (result.ok) {
        setApplied(result.applied);
        router.refresh();
      } else {
        setError(result.error ?? "Failed to apply budget.");
      }
    });
  }

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        AI budget advisor
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Enter your monthly take-home income and let the local model draft a budget from your recent
        spending. Edit anything before applying.
      </p>

      <form onSubmit={generate} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Monthly take-home ($)
          <input
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            type="number"
            min="1"
            step="1"
            placeholder="5000"
            className="w-36 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
          Preference (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. save aggressively, or cut dining"
            className="min-w-[12rem] rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? "Drafting locally…" : rows ? "Regenerate" : "Suggest budget"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {rows ? (
        <div className="mt-5">
          {summary ? (
            <Markdown className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{summary}</Markdown>
          ) : null}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 text-right font-medium">Your avg/mo</th>
                <th className="pb-2 text-right font-medium">Limit ($)</th>
                <th className="hidden pb-2 pl-3 font-medium sm:table-cell">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2">{r.humanName}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatCents(r.avgMonthlyCents)}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      value={r.limitDollars}
                      onChange={(e) => setLimit(r.category, e.target.value)}
                      type="number"
                      min="0"
                      step="1"
                      className="w-24 rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums dark:border-zinc-700"
                    />
                  </td>
                  <td className="hidden py-2 pl-3 text-xs text-zinc-400 sm:table-cell">
                    {r.rationale}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-medium dark:border-zinc-700">
                <td className="py-2">Total budgeted</td>
                <td />
                <td className="py-2 text-right tabular-nums">{formatCents(totalCents)}</td>
                <td className="hidden sm:table-cell" />
              </tr>
              <tr>
                <td className="py-1 text-zinc-500">Projected monthly savings</td>
                <td />
                <td
                  className={`py-1 text-right tabular-nums ${savingsCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                >
                  {formatCents(savingsCents)}
                </td>
                <td className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          </table>

          {savingsCents < 0 ? (
            <p className="mt-2 text-xs text-red-600">
              These limits exceed your income. Trim a category before applying.
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={apply}
              disabled={isApplying}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isApplying ? "Applying…" : "Apply budget"}
            </button>
            {applied !== null ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                Applied {applied} budget{applied === 1 ? "" : "s"}.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
