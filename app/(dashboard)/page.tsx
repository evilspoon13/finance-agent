import { PageShell } from "@/components/PageShell";
import { getNetWorth, type AccountClass } from "@/lib/db/analytics";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<AccountClass, string> = {
  cash: "Cash",
  investment: "Investments",
  liability: "Liabilities",
  other: "Other",
};

export default async function NetWorthPage() {
  const nw = await getNetWorth();

  return (
    <PageShell title="Net Worth" subtitle="Assets minus liabilities across all accounts.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Net Worth" cents={nw.netWorthCents} emphasis />
        <Stat label="Assets" cents={nw.assetsCents} />
        <Stat label="Liabilities" cents={-nw.liabilitiesCents} />
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {nw.lines.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                  No accounts yet — link one on the Connections page.
                </td>
              </tr>
            ) : (
              nw.lines.map((line) => (
                <tr key={line.accountId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2">{line.name}</td>
                  <td className="px-4 py-2 text-zinc-500">{CLASS_LABEL[line.klass]}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      line.valueCents < 0 ? "text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {formatCents(line.valueCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}

function Stat({ label, cents, emphasis }: { label: string; cents: number; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`mt-1 tabular-nums ${emphasis ? "text-3xl font-semibold" : "text-2xl"} ${
          cents < 0 ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {formatCents(cents)}
      </div>
    </div>
  );
}
