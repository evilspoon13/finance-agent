import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/Section";
import {
  getInvestments,
  type InvestmentAccount,
  type InvestmentActivity,
  type InvestmentKind,
} from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<InvestmentKind, string> = {
  taxable: "Taxable Brokerage",
  "401k": "401(k)",
  roth: "Roth IRA",
  ira: "IRA",
  hsa: "HSA",
  other: "Investment",
};

const fmtPct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const gainColor = (n: number | null) =>
  n === null ? "" : n >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400";
const fmtQty = (q: string) => {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : q;
};
const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

export default async function InvestmentsPage() {
  const inv = await getInvestments();

  return (
    <PageShell title="Investments" subtitle="Your brokerage, 401(k), and Roth in detail — expand any account.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total Value" cents={inv.totalValueCents} emphasis />
        <Stat label="Cost Basis" cents={inv.totalCostCents} />
        <GainStat label="Unrealized Gain" cents={inv.totalGainCents} pct={inv.totalGainPct} />
      </div>

      {inv.accounts.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No investment accounts yet — link a brokerage on the Connections page.
        </p>
      ) : (
        <div className="mt-8 space-y-3">
          {inv.accounts.map((a) => (
            <AccountSection key={a.accountId} a={a} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function AccountSection({ a }: { a: InvestmentAccount }) {
  return (
    <Section
      title={`${KIND_LABEL[a.kind]}${a.institution ? ` · ${a.institution}` : ""}`}
      headline={
        <>
          {formatCents(a.valueCents)}
          {a.costCents > 0 ? <span className={`ml-2 ${gainColor(a.gainCents)}`}>{fmtPct(a.gainPct)}</span> : null}
        </>
      }
    >
      <div className="mb-1 text-xs text-zinc-400">{a.name}</div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Value" cents={a.valueCents} />
        <Stat label="Cost Basis" cents={a.costCents} />
        <GainStat label="Unrealized Gain" cents={a.gainCents} pct={a.gainPct} />
      </div>

      {a.holdings.length > 0 ? <HoldingsTable a={a} /> : null}
      {a.activity.length > 0 ? <ActivityTable activity={a.activity} /> : null}
      {a.holdings.length === 0 && a.activity.length === 0 ? (
        <p className="text-sm text-zinc-500">No holdings or activity synced for this account yet.</p>
      ) : null}
    </Section>
  );
}

function HoldingsTable({ a }: { a: InvestmentAccount }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <th className="px-4 py-2 text-left font-semibold">Holding</th>
            <th className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Shares</th>
            <th className="px-4 py-2 text-right font-semibold">Value</th>
            <th className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Cost</th>
            <th className="px-4 py-2 text-right font-semibold">Gain / Loss</th>
            <th className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Allocation</th>
          </tr>
        </thead>
        <tbody>
          {a.holdings.map((h) => (
            <tr key={h.ticker ?? h.name} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-4 py-2">
                <div className="font-medium">{h.ticker ?? "—"}</div>
                <div className="max-w-[16rem] truncate text-xs text-zinc-500">{h.name}</div>
              </td>
              <td className="hidden px-4 py-2 text-right tabular-nums sm:table-cell">{fmtQty(h.quantity)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCents(h.valueCents)}</td>
              <td className="hidden px-4 py-2 text-right tabular-nums text-zinc-500 sm:table-cell">
                {h.costBasisCents != null ? formatCents(h.costBasisCents) : "—"}
              </td>
              <td className={`px-4 py-2 text-right tabular-nums ${gainColor(h.gainCents)}`}>
                {h.gainCents != null ? (
                  <>
                    {h.gainCents >= 0 ? "+" : ""}
                    {formatCents(h.gainCents)}
                    <span className="ml-1 text-xs">{fmtPct(h.gainPct)}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell">
                <div className="flex items-center justify-end gap-2">
                  <span className="tabular-nums text-zinc-500">{h.pctOfPortfolio.toFixed(1)}%</span>
                  <div className="h-1.5 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${h.pctOfPortfolio}%` }} />
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ACTIVITY_STYLE: Record<string, string> = {
  buy: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  sell: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  cash: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  fee: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  transfer: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  cancel: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800",
};

/** Label a cash/dividend row as "Dividend" when Plaid's subtype says so. */
function activityLabel(t: InvestmentActivity): string {
  if (t.type === "cash" && t.subtype) return t.subtype.charAt(0).toUpperCase() + t.subtype.slice(1);
  return t.type.charAt(0).toUpperCase() + t.type.slice(1);
}

function ActivityTable({ activity }: { activity: InvestmentActivity[] }) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Activity</div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <th className="px-4 py-2 text-left font-semibold">Date</th>
              <th className="hidden px-4 py-2 text-left font-semibold sm:table-cell">Type</th>
              <th className="px-4 py-2 text-left font-semibold">Description</th>
              <th className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Shares</th>
              <th className="px-4 py-2 text-right font-semibold">Cash flow</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((t) => {
              // Plaid amount: positive = cash out (buy). Show cash impact on the account.
              const cashFlow = -t.amountCents;
              return (
                <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 whitespace-nowrap text-zinc-500">{fmtDate(t.postedAt)}</td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTIVITY_STYLE[t.type] ?? ACTIVITY_STYLE.buy}`}>
                      {activityLabel(t)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {t.ticker ? <span className="font-medium">{t.ticker} </span> : null}
                    <span className="text-zinc-500">{t.securityName ?? t.name}</span>
                  </td>
                  <td className="hidden px-4 py-2 text-right tabular-nums text-zinc-500 sm:table-cell">
                    {Number(t.quantity) ? fmtQty(t.quantity) : "—"}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums ${cashFlow > 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                    {cashFlow >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(cashFlow))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, cents, emphasis }: { label: string; cents: number; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 tabular-nums ${emphasis ? "text-3xl font-semibold" : "text-2xl"} ${cents < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
        {formatCents(cents)}
      </div>
    </div>
  );
}

function GainStat({ label, cents, pct }: { label: string; cents: number; pct: number | null }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl tabular-nums ${gainColor(cents)}`}>
        {cents >= 0 ? "+" : ""}
        {formatCents(cents)}
        <span className="ml-2 text-base">{fmtPct(pct)}</span>
      </div>
    </div>
  );
}
