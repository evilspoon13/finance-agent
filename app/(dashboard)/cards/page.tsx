import { PageShell } from "@/components/PageShell";
import { listManagedCards, listCreditAccounts } from "@/lib/db/rewards-queries";
import { REWARD_CATEGORIES } from "@/lib/rewards/reward-categories";
import { CardManager } from "@/components/CardManager";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const [cards, accounts] = await Promise.all([listManagedCards(), listCreditAccounts()]);
  return (
    <PageShell
      title="Cards"
      subtitle="Your credit cards and their reward rates — these power the rewards guidance. Syncing adds any new card at 1%; set the real rates here. For points or miles, enter the cash value you put on a point (e.g. 1.3% for 1x at 1.3¢)."
    >
      <CardManager cards={cards} accounts={accounts} categories={REWARD_CATEGORIES} />
    </PageShell>
  );
}
