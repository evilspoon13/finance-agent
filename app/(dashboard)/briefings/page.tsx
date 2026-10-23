import { PageShell } from "@/components/PageShell";
import { listBriefings } from "@/lib/db/agent-queries";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  daily: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  weekly: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  adhoc: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

/** What the scheduled finance agent reported, newest first (see docs/agent.md). */
export default async function BriefingsPage() {
  const briefings = await listBriefings(60);
  return (
    <PageShell
      title="Briefings"
      subtitle="Reports from your scheduled finance agent. Ones marked “sent” also went to Discord."
    >
      {briefings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No briefings yet. They appear here after the agent&apos;s first run.
        </p>
      ) : (
        <ul className="space-y-3">
          {briefings.map((b) => (
            <li key={b.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <details open={b === briefings[0]} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4">
                  <span className="text-zinc-400 transition-transform group-open:rotate-90">▶</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[b.kind] ?? KIND_STYLE.adhoc}`}>
                    {b.kind}
                  </span>
                  <span className="font-medium">{b.title}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {b.createdAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/Los_Angeles",
                    })}
                    {b.notified ? " · sent" : ""}
                  </span>
                </summary>
                <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{b.body}</div>
                  {b.sessionUrl ? (
                    <a href={b.sessionUrl} className="mt-3 inline-block text-sm font-medium hover:underline">
                      Continue in Claude →
                    </a>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
