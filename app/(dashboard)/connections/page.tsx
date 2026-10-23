import { PageShell } from "@/components/PageShell";
import { PlaidConnect, type ItemDTO } from "@/components/PlaidConnect";
import { SyncButton } from "@/components/SyncButton";
import { ManualAccountForm } from "@/components/ConnectionControls";
import { listItemsWithAccounts } from "@/lib/db/queries";
import { isManualItem } from "@/lib/plaid/sync";

// Reads the DB on every request.
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const items = await listItemsWithAccounts();
  const dto: ItemDTO[] = items.map((item) => ({
    id: item.id,
    institutionName: item.institutionName,
    status: item.status,
    manual: isManualItem(item),
    accounts: item.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
    })),
  }));

  return (
    <PageShell title="Connections" subtitle="Linked institutions and account statuses.">
      <div className="space-y-6">
        {items.length > 0 ? <SyncButton /> : null}
        <PlaidConnect items={dto} />
        <ManualAccountForm />
      </div>
    </PageShell>
  );
}
