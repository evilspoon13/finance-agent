import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { PageShell } from "@/components/PageShell";
import { parseProfile, PROFILE_KEY } from "@/lib/agent/profile";
import { scoreProposal } from "@/lib/agent/portfolio";
import { countPendingKnowledge, getContext, listActions, listBriefings } from "@/lib/db/agent-queries";
import { latestPrices, listIdeas, listMemos, listProposals } from "@/lib/db/research-queries";
import type { AgentAction, InvestmentIdea, InvestmentProposal, ResearchMemo } from "@/lib/db/schema";
import { answerQuestionAction, decideProposalAction, setActionStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  daily: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  weekly: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  monthly: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  adhoc: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  pulse: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  deep_dive: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const formatWhen = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const signed = (pct: number) => `${pct > 0 ? "+" : ""}${pct}%`;

/** What the scheduled finance agent reported, newest first (see docs/agent.md). */
export default async function BriefingsPage(props: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await props.searchParams;
  const research = tab === "research";
  return (
    <PageShell
      title="Briefings"
      subtitle="Reports from your scheduled finance agent. Open one and continue in Claude to reply."
    >
      <div className="mb-6 flex gap-2">
        <TabLink href="/briefings" active={!research} label="Reports" />
        <TabLink href="/briefings?tab=research" active={research} label="Research" />
      </div>
      {research ? <ResearchTab /> : <ReportsTab />}
    </PageShell>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </Link>
  );
}

async function ReportsTab() {
  const [briefings, actions, unconfirmed] = await Promise.all([listBriefings(60), listActions(), countPendingKnowledge()]);
  const open = actions.filter((a) => a.status === "open");
  const questions = open.filter((a) => a.kind === "question");
  const todo = open.filter((a) => a.kind !== "question");
  const closed = actions.filter((a) => a.status !== "open");
  return (
    <>
      {unconfirmed > 0 ? (
        <Link
          href="/knowledge"
          className="mb-6 block rounded-lg border border-amber-300 p-3 text-sm font-medium hover:bg-amber-50 dark:border-amber-800 dark:hover:bg-amber-950/30"
        >
          {unconfirmed} {unconfirmed === 1 ? "thing" : "things"} the agent learned need your review →
        </Link>
      ) : null}

      {questions.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h3 className="text-sm font-semibold">Questions for you</h3>
          <ul className="space-y-2">
            {questions.map((q) => (
              <QuestionRow key={q.id} question={q} />
            ))}
          </ul>
        </section>
      ) : null}

      {actions.length > questions.length ? (
        <section className="mb-8 space-y-3">
          <h3 className="text-sm font-semibold">Follow-ups</h3>
          {todo.length === 0 ? <p className="text-sm text-zinc-500">Nothing open.</p> : null}
          <ul className="space-y-2">
            {todo.map((a) => (
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
                    {formatWhen(b.createdAt)}
                    {b.notified ? " · needs you" : ""}
                  </span>
                </summary>
                <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
                  <Markdown>{b.body}</Markdown>
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
    </>
  );
}

async function ResearchTab() {
  const [proposals, ideas, memos, raw] = await Promise.all([listProposals(), listIdeas(), listMemos(), getContext(PROFILE_KEY)]);
  const benchmark = parseProfile(raw).stocks.benchmark;
  const prices = await latestPrices([...new Set([benchmark, ...proposals.flatMap((p) => [p.ticker, p.benchmarkTicker])])]);
  const scored = proposals.map((p) => ({
    proposal: p,
    score: scoreProposal({
      entryCents: p.entryPriceCents,
      benchEntryCents: p.benchmarkPriceCents,
      nowCents: prices.get(p.ticker) ?? null,
      benchNowCents: prices.get(p.benchmarkTicker) ?? null,
    }),
  }));
  const judged = scored.flatMap((s) => (s.score ? [s.score] : []));
  const average = judged.length
    ? Math.round((judged.reduce((t, s) => t + s.excessPct, 0) / judged.length) * 10) / 10
    : null;
  const watched = ideas.filter((i) => i.status !== "rejected");

  return (
    <>
      <section className="mb-8 space-y-3">
        <h3 className="text-sm font-semibold">Proposals</h3>
        {average !== null ? (
          <p className="text-sm text-zinc-500">
            Average result vs {benchmark}: <span className="font-medium">{signed(average)}</span> across {judged.length}{" "}
            {judged.length === 1 ? "proposal" : "proposals"}, whether or not you acted on them.
          </p>
        ) : null}
        {proposals.length === 0 ? <p className="text-sm text-zinc-500">No proposals yet.</p> : null}
        <ul className="space-y-2">
          {scored.map(({ proposal, score }) => (
            <ProposalRow key={proposal.id} proposal={proposal} score={score} />
          ))}
        </ul>
      </section>

      {watched.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h3 className="text-sm font-semibold">Watchlist</h3>
          <ul className="space-y-2">
            {watched.map((i) => (
              <IdeaRow key={i.ticker} idea={i} />
            ))}
          </ul>
        </section>
      ) : null}

      <h3 className="mb-1 text-sm font-semibold">Research memos</h3>
      <p className="mb-3 text-sm text-zinc-500">Written from web sources. Check the sources before acting on anything here.</p>
      {memos.length === 0 ? <p className="text-sm text-zinc-500">No research yet.</p> : null}
      <ul className="space-y-3">
        {memos.map((m, i) => (
          <MemoRow key={m.id} memo={m} open={i === 0} />
        ))}
      </ul>
    </>
  );
}

function ProposalRow({ proposal: p, score }: { proposal: InvestmentProposal; score: ReturnType<typeof scoreProposal> }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium">
        {p.action === "hold" ? "Hold" : `${p.action === "buy" ? "Buy" : "Sell"} ${money(p.amountCents)} of`} {p.ticker} · {p.account}
      </p>
      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        <Markdown>{p.rationale}</Markdown>
      </div>
      {p.entryCondition ? <p className="mt-1 text-xs text-zinc-500">Entry: {p.entryCondition}</p> : null}
      {p.invalidation ? <p className="mt-0.5 text-xs text-zinc-500">Wrong if: {p.invalidation}</p> : null}
      <p className="mt-1 text-xs text-zinc-500">
        {p.createdAt.toISOString().slice(0, 10)}
        {p.reviewOn ? ` · review ${p.reviewOn}` : ""}
        {score ? ` · ${signed(score.returnPct)} vs ${p.benchmarkTicker} ${signed(score.benchmarkPct)}` : ""}
        {p.status === "proposed" ? "" : ` · ${p.status}${p.decisionNote ? ` — ${p.decisionNote}` : ""}`}
      </p>
      {p.status === "proposed" ? (
        <form action={decideProposalAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input
            name="note"
            maxLength={1000}
            placeholder="Note (optional)"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2.5 py-1 text-base sm:text-xs dark:border-zinc-700"
          />
          <button type="submit" name="status" value="accepted" className={SMALL_BUTTON}>
            I did this
          </button>
          <button type="submit" name="status" value="declined" className={SMALL_BUTTON}>
            Decline
          </button>
        </form>
      ) : null}
    </li>
  );
}

function IdeaRow({ idea: i }: { idea: InvestmentIdea }) {
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3 text-sm">
          <span className="font-medium">{i.ticker}</span>
          {i.name ? <span className="text-zinc-500">{i.name}</span> : null}
          <span className="ml-auto text-xs text-zinc-500">
            {i.status}
            {i.nextReviewOn ? ` · review ${i.nextReviewOn}` : ""}
          </span>
        </summary>
        <div className="space-y-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
          {[
            ["Thesis", i.thesis],
            ["Bear case", i.bearCase],
            ["Valuation", i.valuation],
            ["Wrong if", i.invalidation],
          ].map(([label, value]) =>
            value ? (
              <div key={label}>
                <p className="text-xs font-medium text-zinc-500">{label}</p>
                <Markdown>{value}</Markdown>
              </div>
            ) : null,
          )}
        </div>
      </details>
    </li>
  );
}

function MemoRow({ memo: m, open }: { memo: ResearchMemo; open: boolean }) {
  const sources = m.sources as { title: string; url: string; date?: string }[];
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4">
          <span className="text-zinc-400 transition-transform group-open:rotate-90">▶</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[m.kind] ?? KIND_STYLE.adhoc}`}>
            {m.kind.replace("_", " ")}
          </span>
          <span className="font-medium">{m.title}</span>
          <span className="ml-auto text-xs text-zinc-500">{formatWhen(m.createdAt)}</span>
        </summary>
        <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          <Markdown>{m.body}</Markdown>
          {sources.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500">Sources ({sources.length})</summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {s.title}
                    </a>
                    {s.date ? <span className="text-zinc-500"> · {s.date}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/** A question from the agent, answered in place. */
function QuestionRow({ question: q }: { question: AgentAction }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium">{q.title}</p>
      {q.detail ? <p className="mt-0.5 text-sm text-zinc-500">{q.detail}</p> : null}
      <form action={answerQuestionAction} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={q.id} />
        <input
          name="answer"
          required
          maxLength={4000}
          placeholder="Your answer"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-base sm:text-sm dark:border-zinc-700"
        />
        <button type="submit" className={SMALL_BUTTON}>
          Answer
        </button>
      </form>
    </li>
  );
}

const SMALL_BUTTON =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

function StatusButton({ id, status, label }: { id: string; status: AgentAction["status"]; label: string }) {
  return (
    <form action={setActionStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={SMALL_BUTTON}>
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
        {a.answer ? <p className="mt-0.5 text-sm">You said: {a.answer}</p> : null}
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
