import { PageShell } from "@/components/PageShell";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { SyncButton } from "@/components/SyncButton";
import { listItemsWithAccounts, type ItemWithAccounts } from "@/lib/db/queries";
import { formatCents } from "@/lib/money";

// Reads the DB on every request.
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  login_required: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default async function ConnectionsPage() {
  const items = await listItemsWithAccounts();

  return (
    <PageShell title="Connections" subtitle="Linked institutions and account statuses.">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <PlaidLinkButton />
          {items.length > 0 ? <SyncButton /> : null}
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No institutions linked yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}

function ItemCard({ item }: { item: ItemWithAccounts }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{item.institutionName}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_STYLE[item.status] ?? STATUS_STYLE.error
          }`}
        >
          {item.status}
        </span>
      </div>
      {item.status === "login_required" ? (
        <button
          type="button"
          disabled
          title="Reconnect via Link update mode (coming in a later phase)"
          className="mt-2 rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-700 disabled:opacity-60"
        >
          Reconnect
        </button>
      ) : null}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-1 font-medium">Account</th>
            <th className="py-1 font-medium">Type</th>
            <th className="py-1 font-medium">Mask</th>
            <th className="py-1 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {item.accounts.map((a) => (
            <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">{a.name}</td>
              <td className="py-1.5 text-zinc-500">
                {a.type}
                {a.subtype ? ` / ${a.subtype}` : ""}
              </td>
              <td className="py-1.5 text-zinc-500">{a.mask ? `••${a.mask}` : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">
                {a.currentBalanceCents === null ? "—" : formatCents(a.currentBalanceCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}
