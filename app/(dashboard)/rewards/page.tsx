import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { analyzeRewards, type RewardWindow } from "@/lib/rewards/compute";
import { quarterKey, discoverCategoriesFor, MILES_VALUE_CENTS } from "@/lib/rewards/config";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";
import type { RawSearchParams } from "@/lib/filters";

export const dynamic = "force-dynamic";

type WindowKey = "month" | "quarter" | "all";

function windowFor(key: WindowKey): RewardWindow | undefined {
  const now = new Date();
  if (key === "month") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
  }
  if (key === "quarter") {
    const q = Math.floor(now.getUTCMonth() / 3) * 3;
    return { from: new Date(Date.UTC(now.getUTCFullYear(), q, 1)) };
  }
  return undefined;
}

export default async function RewardsPage(props: { searchParams: Promise<RawSearchParams> }) {
  const sp = await props.searchParams;
  const rawWindow = Array.isArray(sp.window) ? sp.window[0] : sp.window;
  const windowKey: WindowKey = rawWindow === "month" || rawWindow === "quarter" ? rawWindow : "all";

  const report = await analyzeRewards(windowFor(windowKey));
  const now = new Date();
  const activeCats = discoverCategoriesFor(now);

  if (!report.hasCards) {
    return (
      <PageShell title="Rewards" subtitle="Best-card guidance and missed rewards.">
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No cards seeded yet. Run a sync to link your cards.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Rewards"
      subtitle={`Computed from current rules. Discover ${quarterKey(now)} 5%: ${
        activeCats.length ? activeCats.map((c) => humanizeCategory(c)).join(", ") : "not announced"
      }. Miles valued at ${MILES_VALUE_CENTS}¢.`}
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(["month", "quarter", "all"] as const).map((k) => {
          const label = k === "month" ? "This month" : k === "quarter" ? "This quarter" : "All time";
          const active = k === windowKey;
          return (
            <Link
              key={k}
              href={k === "all" ? "/rewards" : `/rewards?window=${k}`}
              className={`rounded-full border px-3 py-1 ${
                active
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Value earned</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {formatCents(report.totalEarnedCents)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Missed rewards</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCents(report.totalMissedCents)}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Earned per card
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {report.perCard.map((c) => (
              <tr key={c.cardId} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2">{c.label}</td>
                <td className="py-2 text-zinc-500">{c.txnCount} purchases</td>
                <td className="py-2 text-right tabular-nums">{formatCents(c.earnedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Which card to use
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {report.guide.map((g) => (
              <tr key={g.category} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2">
                  {g.category === "everything else" ? "Everything else" : humanizeCategory(g.category)}
                </td>
                <td className="py-2">{g.bestLabel}</td>
                <td className="py-2 text-right tabular-nums text-zinc-500">
                  {(g.effectiveBps / 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Missed rewards (used a suboptimal card)
        </h3>
        {report.missed.length === 0 ? (
          <p className="text-sm text-zinc-500">No missed rewards — nice.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Merchant</th>
                  <th className="px-3 py-2 font-medium">Used</th>
                  <th className="px-3 py-2 font-medium">Should have used</th>
                  <th className="px-3 py-2 text-right font-medium">Missed</th>
                </tr>
              </thead>
              <tbody>
                {report.missed.slice(0, 50).map((m) => (
                  <tr key={m.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                      {m.postedAt ? m.postedAt.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="px-3 py-2">{m.label}</td>
                    <td className="px-3 py-2 text-zinc-500">{m.actualLabel}</td>
                    <td className="px-3 py-2">{m.optimalLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {formatCents(m.deltaCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
