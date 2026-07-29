import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/Section";
import {
  getNetWorth,
  getPortfolio,
  getIncomeSummary,
  type AccountClass,
  type NetWorth,
  type Portfolio,
  type IncomeSummary,
} from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<AccountClass, string> = {
  cash: "Cash",
  investment: "Investments",
  liability: "Liabilities",
  other: "Other",
};

const fmtPct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const gainColor = (n: number | null) =>
  n === null ? "" : n >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400";

export default async function NetWorthPage() {
  const [nw, portfolio, income] = await Promise.all([getNetWorth(), getPortfolio(), getIncomeSummary()]);
  const thisYear = new Date().getUTCFullYear();
  const hasIncome = income.paychecks.length > 0 || income.ytdCents > 0;

  return (
    <PageShell title="Net Worth" subtitle="Your at-a-glance summary — expand any section for detail.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Net Worth" cents={nw.netWorthCents} emphasis />
        <Stat label="Assets" cents={nw.assetsCents} />
        <Stat label="Liabilities" cents={-nw.liabilitiesCents} />
      </div>

      {nw.lines.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No accounts yet — link one on the Connections page.
        </p>
      ) : (
        <div className="mt-8 space-y-3">
          <Section title="Accounts" headline={`${nw.lines.length} accounts`} defaultOpen>
            <AccountsBody nw={nw} />
          </Section>

          {portfolio.holdings.length > 0 ? (
            <Section
              title="Portfolio"
              headline={
                <>
                  {formatCents(portfolio.totalValueCents)}
                  <span className={`ml-2 ${gainColor(portfolio.totalGainCents)}`}>{fmtPct(portfolio.totalGainPct)}</span>
                </>
              }
            >
              <PortfolioBody p={portfolio} />
            </Section>
          ) : null}

          {hasIncome ? (
            <Section title="Paychecks & income" headline={`${formatCents(income.ytdCents)} YTD`}>
              <IncomeBody income={income} year={thisYear} />
            </Section>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}

function AccountsBody({ nw }: { nw: NetWorth }) {
  return (
    <div className="space-y-6">
      {(["cash", "investment", "liability", "other"] as const).map((klass) => {
        const group = nw.lines.filter((l) => l.klass === klass);
        if (group.length === 0) return null;
        const subtotal = group.reduce((n, l) => n + l.valueCents, 0);
        return (
          <div key={klass} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 dark:bg-zinc-900">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{CLASS_LABEL[klass]}</span>
              <span className={`text-sm font-medium tabular-nums ${subtotal < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                {formatCents(subtotal)}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {group.map((line) => (
                  <tr key={line.accountId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">{line.name}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${line.valueCents < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCents(line.valueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function PortfolioBody({ p }: { p: Portfolio }) {
  const fmtQty = (q: string) => {
    const n = Number(q);
    return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : q;
  };

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Portfolio Value" cents={p.totalValueCents} />
        <Stat label="Cost Basis" cents={p.totalCostCents} />
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Unrealized Gain</div>
          <div className={`mt-1 text-2xl tabular-nums ${gainColor(p.totalGainCents)}`}>
            {p.totalGainCents >= 0 ? "+" : ""}
            {formatCents(p.totalGainCents)}
            <span className="ml-2 text-base">{fmtPct(p.totalGainPct)}</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <th className="px-4 py-2 text-left font-semibold">Holding</th>
              <th className="px-4 py-2 text-right font-semibold">Shares</th>
              <th className="px-4 py-2 text-right font-semibold">Value</th>
              <th className="px-4 py-2 text-right font-semibold">Cost</th>
              <th className="px-4 py-2 text-right font-semibold">Gain / Loss</th>
              <th className="px-4 py-2 text-right font-semibold">Allocation</th>
            </tr>
          </thead>
          <tbody>
            {p.holdings.map((h) => (
              <tr key={`${h.ticker ?? h.name}`} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <div className="font-medium">{h.ticker ?? "—"}</div>
                  <div className="truncate text-xs text-zinc-500">{h.name}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtQty(h.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCents(h.valueCents)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
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
                <td className="px-4 py-2">
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
    </>
  );
}

/** Strip the INCOME_ prefix from a pfc_detailed code → "Salary", "Tax refund". */
function incomeTypeLabel(code: string): string {
  const tail = code.startsWith("INCOME_") ? code.slice("INCOME_".length) : code;
  return humanizeCategory(tail);
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function IncomeBody({ income, year }: { income: IncomeSummary; year: number }) {
  return (
    <>
      <p className="mb-3 text-xs text-zinc-400">
        Net deposits from your employer (bank accounts only). Plaid doesn&rsquo;t expose gross pay, taxes, or 401(k) —
        those would need a manual stub log.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={`${year} income (YTD)`} cents={income.ytdCents} />
        <Stat label="Last 12 months" cents={income.last12moCents} />
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Latest paycheck</div>
          <div className="mt-1 text-2xl tabular-nums">
            {income.paychecks[0] ? formatCents(income.paychecks[0].amountCents) : "—"}
          </div>
          {income.paychecks[0] ? <div className="mt-0.5 text-xs text-zinc-400">{fmtDate(income.paychecks[0].postedAt)}</div> : null}
        </div>
      </div>

      {income.ytdByType.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {income.ytdByType.map((t) => (
            <span key={t.type} className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              {incomeTypeLabel(t.type)}: <span className="tabular-nums">{formatCents(t.cents)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {income.paychecks.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <th className="px-4 py-2 text-left font-semibold">Date</th>
                <th className="px-4 py-2 text-left font-semibold">Employer</th>
                <th className="px-4 py-2 text-right font-semibold">Net deposit</th>
              </tr>
            </thead>
            <tbody>
              {income.paychecks.map((p, i) => (
                <tr key={`${p.employer}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-500">{fmtDate(p.postedAt)}</td>
                  <td className="px-4 py-2">{p.employer}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
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
