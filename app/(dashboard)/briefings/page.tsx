import { PageShell } from "@/components/PageShell";
import { listActions, listBriefings } from "@/lib/db/agent-queries";
import type { AgentAction } from "@/lib/db/schema";
import { setActionStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  daily: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  weekly: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  monthly: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  adhoc: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

/** What the scheduled finance agent reported, newest first (see docs/agent.md). */
export default async function BriefingsPage() {
  const [briefings, actions] = await Promise.all([listBriefings(60), listActions()]);
  const open = actions.filter((a) => a.status === "open");
  const closed = actions.filter((a) => a.status !== "open");
  return (
    <PageShell
      title="Briefings"
      subtitle="Reports from your scheduled finance agent. Ones marked “sent” also went to Discord."
    >
      {actions.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h3 className="text-sm font-semibold">Follow-ups</h3>
          {open.length === 0 ? <p className="text-sm text-zinc-500">Nothing open.</p> : null}
          <ul className="space-y-2">
            {open.map((a) => (
              <ActionRow key={a.id} action={a} />
            ))}
            {closed.map((a) => (
              <ActionRow key={a.id} action={a} />
            ))}
          </ul>
        </section>
      ) : null}

      <h3 className="mb-3 text-sm font-semibold">Reports</h3>
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

function StatusButton({ id, status, label }: { id: string; status: AgentAction["status"]; label: string }) {
  return (
    <form action={setActionStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {label}
      </button>
    </form>
  );
}

/** One follow-up: open ones get Done/Dismiss, closed ones show how they ended. */
function ActionRow({ action: a }: { action: AgentAction }) {
  const isOpen = a.status === "open";
  return (
    <li
      className={`flex flex-wrap items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 ${
        isOpen ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${isOpen ? "" : "line-through"}`}>{a.title}</p>
        {a.detail ? <p className="mt-0.5 text-sm text-zinc-500">{a.detail}</p> : null}
        <p className="mt-1 text-xs text-zinc-500">
          {a.dueOn ? `Due ${a.dueOn}` : "No due date"}
          {isOpen ? "" : ` · ${a.status}${a.note ? ` — ${a.note}` : ""}`}
        </p>
      </div>
      <div className="flex gap-2">
        {isOpen ? (
          <>
            <StatusButton id={a.id} status="done" label="Done" />
            <StatusButton id={a.id} status="dismissed" label="Dismiss" />
          </>
        ) : (
          <StatusButton id={a.id} status="open" label="Reopen" />
        )}
      </div>
    </li>
  );
}
