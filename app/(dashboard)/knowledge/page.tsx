import { PageShell } from "@/components/PageShell";
import { KNOWLEDGE_TOPICS } from "@/lib/agent/knowledge";
import { listKnowledge } from "@/lib/db/agent-queries";
import type { AgentKnowledge } from "@/lib/db/schema";
import { confirmFactAction, rejectFactAction, saveFactAction } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  user: "from you",
  observed: "seen in your data",
  reported: "agent's summary of a reply",
  inferred: "agent's guess",
};

const topicLabel = (t: string) => t.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const input = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base sm:text-sm dark:border-zinc-700";
const button = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** What the finance agent knows, and the guesses it can't treat as fact until confirmed. */
export default async function KnowledgePage() {
  const facts = await listKnowledge();
  const pending = facts.filter((f) => f.status === "pending_review");
  const live = facts.filter((f) => f.status === "active");
  const topics = KNOWLEDGE_TOPICS.filter((t) => live.some((f) => f.topic === t));

  return (
    <PageShell title="Knowledge" subtitle="What your finance agent knows about you. Every run reads this.">
      {pending.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h3 className="text-sm font-semibold">Needs your review ({pending.length})</h3>
          <p className="text-sm text-zinc-500">
            The agent wrote these but can&apos;t rely on them until you confirm. Reject anything it got wrong.
          </p>
          <ul className="space-y-2">
            {pending.map((f) => (
              <li key={f.id} className="rounded-lg border border-amber-300 p-3 dark:border-amber-800">
                <FactBody fact={f} />
                <div className="mt-2 flex gap-2">
                  <form action={confirmFactAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className={button}>
                      Confirm
                    </button>
                  </form>
                  <form action={rejectFactAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className={button}>
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {topics.length === 0 ? <p className="mb-8 text-sm text-zinc-500">Nothing stored yet.</p> : null}
      {topics.map((topic) => (
        <section key={topic} className="mb-8 space-y-2">
          <h3 className="text-sm font-semibold">{topicLabel(topic)}</h3>
          <ul className="space-y-2">
            {live
              .filter((f) => f.topic === topic)
              .map((f) => (
                <li key={f.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <FactBody fact={f} />
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-zinc-500">Edit</summary>
                    <FactForm fact={f} />
                  </details>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Add a fact</h3>
        <FactForm />
      </section>
    </PageShell>
  );
}

function FactBody({ fact }: { fact: AgentKnowledge }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm">{fact.body}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {fact.slug} · {SOURCE_LABEL[fact.source] ?? fact.source}
        {fact.expiresOn ? ` · until ${fact.expiresOn}` : ""}
        {fact.sessionUrl ? (
          <>
            {" · "}
            <a href={fact.sessionUrl} className="underline">
              conversation
            </a>
          </>
        ) : null}
      </p>
    </>
  );
}

function FactForm({ fact }: { fact?: AgentKnowledge }) {
  return (
    <form action={saveFactAction} className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          name="slug"
          required
          defaultValue={fact?.slug}
          readOnly={Boolean(fact)}
          placeholder="short-name-like-this"
          pattern="[a-z0-9][a-z0-9\-]{1,79}"
          className={`${input} min-w-0 flex-1`}
        />
        <select name="topic" required defaultValue={fact?.topic ?? "profile"} className={input}>
          {KNOWLEDGE_TOPICS.map((t) => (
            <option key={t} value={t}>
              {topicLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <textarea name="body" required rows={3} maxLength={4000} defaultValue={fact?.body} className={`${input} w-full`} />
      <div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Save
        </button>
      </div>
    </form>
  );
}
