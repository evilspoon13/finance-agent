import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/Section";
import { analyzeRewards, type RewardWindow, type RewardsReport } from "@/lib/rewards/compute";
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
          No cards yet. Connect a credit account and sync, or add cards on the{" "}
          <Link href="/cards" className="underline underline-offset-2">
            Cards
          </Link>{" "}
          page.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Rewards"
      subtitle={`Best-card guidance and rewards left on the table. Discover ${quarterKey(now)} 5%: ${
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

      {/* At-a-glance summary (always visible) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Value earned</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{formatCents(report.totalEarnedCents)}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Missed rewards</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCents(report.totalMissedCents)}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Section title="Which card to use" headline={`${report.guide.length} categories`}>
          <GuideBody report={report} />
        </Section>

        <Section title="Earned per card" headline={formatCents(report.totalEarnedCents)}>
          <PerCardBody report={report} />
        </Section>

        <Section
          title="Missed rewards"
          headline={
            <span className="text-amber-600 dark:text-amber-400">
              {report.missed.length === 0 ? "None" : formatCents(report.totalMissedCents)}
            </span>
          }
        >
          <MissedBody report={report} />
        </Section>
      </div>
    </PageShell>
  );
}

function GuideBody({ report }: { report: RewardsReport }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
          <th className="pb-2 font-medium">Category</th>
          <th className="pb-2 font-medium">Best card</th>
          <th className="pb-2 text-right font-medium">Rate</th>
        </tr>
      </thead>
      <tbody>
        {report.guide.map((g) => (
          <tr key={g.category} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="py-2">{g.category === "everything else" ? "Everything else" : humanizeCategory(g.category)}</td>
            <td className="py-2">{g.bestLabel}</td>
            <td className="py-2 text-right tabular-nums text-zinc-500">{(g.effectiveBps / 100).toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PerCardBody({ report }: { report: RewardsReport }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {report.perCard.map((c) => (
          <tr key={c.cardId} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
            <td className="py-2 font-medium">{c.label}</td>
            <td className="py-2 text-zinc-500">{c.txnCount} purchases</td>
            <td className="py-2 text-right tabular-nums">{formatCents(c.earnedCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MissedBody({ report }: { report: RewardsReport }) {
  if (report.missed.length === 0) {
    return <p className="text-sm text-zinc-500">No missed rewards — you used the best card every time. Nice.</p>;
  }
  return (
    <>
      <p className="mb-3 text-xs text-zinc-400">
        Card purchases where a different card you hold would have earned more. Bank transfers and rent aren&rsquo;t
        card-eligible, so they&rsquo;re excluded.
      </p>
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
        {report.missed.length > 50 ? (
          <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-800">
            Showing the top 50 of {report.missed.length} by amount.
          </p>
        ) : null}
      </div>
    </>
  );
}
