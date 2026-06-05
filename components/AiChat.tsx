"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What restaurant did I spend the most on?",
  "What am I overspending on vs my budget?",
  "How much did I spend on groceries last month?",
  "Which card should I use for dining?",
];

/**
 * Tool-using finance Q&A chat. Sends the conversation to /api/ai/ask, which
 * runs the read-only agent. Optionally auto-asks an initial question.
 */
export function AiChat({ initialQuestion }: { initialQuestion?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const askedInitial = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    async (question: string, prior: Message[]) => {
      setLoading(true);
      try {
        const res = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history: prior }),
        });
        const data = (await res.json()) as { answer?: string; error?: string };
        const content = res.ok ? (data.answer ?? "") : (data.error ?? "Something went wrong.");
        setMessages((m) => [...m, { role: "assistant", content }]);
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Request failed." }]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const submit = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || loading) return;
      const prior = messages;
      setMessages((m) => [...m, { role: "user", content: q }]);
      setInput("");
      void ask(q, prior);
    },
    [ask, loading, messages],
  );

  // Auto-ask the initial question once (e.g. from the Spending ask box).
  useEffect(() => {
    if (initialQuestion && !askedInitial.current) {
      askedInitial.current = true;
      submit(initialQuestion);
    }
  }, [initialQuestion, submit]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="flex flex-col">
      <div className={`space-y-4 ${messages.length === 0 && !loading ? "" : "min-h-[200px]"}`}>
        {messages.length === 0 && !loading ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">Ask anything about your finances. Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${
                m.role === "user"
                  ? "whitespace-pre-wrap bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
              }`}
            >
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}
            </div>
          </div>
        ))}
        {loading ? (
          <div className="inline-block animate-pulse rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-400 dark:bg-zinc-800">
            Thinking…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your spending, budgets, net worth, rewards…"
          className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
