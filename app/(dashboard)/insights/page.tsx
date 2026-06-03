import { PageShell } from "@/components/PageShell";
import { AiChat } from "@/components/AiChat";
import type { RawSearchParams } from "@/lib/filters";

export const dynamic = "force-dynamic";

export default async function InsightsPage(props: { searchParams: Promise<RawSearchParams> }) {
  const sp = await props.searchParams;
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;

  return (
    <PageShell
      title="Insights"
      subtitle="Ask questions about your finances. Answers run locally and cite only your real data."
    >
      <AiChat initialQuestion={q} />
    </PageShell>
  );
}
