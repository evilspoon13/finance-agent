"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";

/**
 * Global AI chat dock: a floating launcher that opens a resizable slide-in panel
 * with ChatGPT-style multi-conversation history. Conversations and messages are
 * persisted server-side (see /api/ai/conversations and /api/ai/ask), so the
 * agent always answers with the full history of the selected conversation.
 *
 * Layout: a collapsible Conversations rail (expanded by default) on the left and
 * the active chat on the right. The panel is drag-resizable up to 75% of the
 * viewport. The launcher hides while open so it never covers the Ask button.
 */

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}
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

const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 440;
const WIDTH_KEY = "chatdock.width";
const RAIL_KEY = "chatdock.rail";

function maxWidth(): number {
  return typeof window === "undefined" ? 900 : Math.round(window.innerWidth * 0.75);
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [railOpen, setRailOpen] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // awaiting an answer
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Restore persisted width / rail state after mount (deferred a frame so it's
  // not a synchronous effect setState, and avoids any SSR hydration mismatch —
  // the panel is off-screen until opened anyway).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
      if (savedWidth) setWidth(Math.max(MIN_WIDTH, Math.min(savedWidth, maxWidth())));
      if (localStorage.getItem(RAIL_KEY) === "0") setRailOpen(false);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep within 75% if the window shrinks.
  useEffect(() => {
    const onResize = () => setWidth((w) => Math.min(w, maxWidth()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const w = window.innerWidth - ev.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(w, maxWidth())));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((r) => {
      localStorage.setItem(RAIL_KEY, r ? "0" : "1");
      return !r;
    });
  }, []);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/ai/conversations");
    if (!res.ok) return [] as ConversationSummary[];
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  // On first open, load the list and select the most recent conversation.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const list = await loadConversations();
      const first = list[0];
      if (first && activeId === null) setActiveId(first.id);
    })();
  }, [open, loadConversations, activeId]);

  // Load the transcript whenever a conversation is selected.
  useEffect(() => {
    if (activeId === null) return;
    void (async () => {
      const res = await fetch(`/api/ai/conversations/${activeId}`);
      if (res.ok) {
        const data = (await res.json()) as { messages: Message[] };
        setMessages(data.messages);
      }
    })();
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Close when clicking anywhere outside the panel (the page stays interactive).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const newChat = useCallback(async () => {
    const res = await fetch("/api/ai/conversations", { method: "POST" });
    if (!res.ok) return null;
    const { conversation } = (await res.json()) as { conversation: ConversationSummary };
    setConversations((c) => [conversation, ...c]);
    setActiveId(conversation.id);
    setMessages([]);
    return conversation.id;
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
      setConversations((c) => c.filter((x) => x.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    },
    [activeId],
  );

  const submit = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || loading) return;

      let id = activeId;
      if (id === null) id = await newChat();
      if (id === null) return;

      setInput("");
      setMessages((m) => [...m, { role: "user", content: question }]);
      setLoading(true);
      try {
        const res = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: id, question }),
        });
        const data = (await res.json()) as { answer?: string; error?: string };
        const content = res.ok ? (data.answer ?? "") : (data.error ?? "Something went wrong.");
        setMessages((m) => [...m, { role: "assistant", content }]);
        void loadConversations(); // refresh titles/ordering (first message sets the title)
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Request failed." }]);
      } finally {
        setLoading(false);
      }
    },
    [activeId, loading, newChat, loadConversations],
  );

  return (
    <>
      {/* Floating launcher — only when closed, so it never covers the Ask button. */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI chat"
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg shadow-zinc-900/20 transition hover:scale-105 dark:bg-white dark:text-zinc-900"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6a8.5 8.5 0 0 1-.9-3.9A8.38 8.38 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}

      {/* Slide-in panel */}
      <aside
        ref={panelRef}
        style={{ width, maxWidth: "75vw" }}
        className={`fixed right-0 top-0 z-40 flex h-full flex-col border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-300 dark:border-zinc-800 dark:bg-zinc-950 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drag-to-resize handle on the left edge */}
        <div
          onPointerDown={startResize}
          className="group absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize"
          aria-hidden="true"
        >
          <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleRail}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={railOpen ? "Hide conversations" : "Show conversations"}
              title="Conversations"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
              </svg>
            </button>
            <span className="text-sm font-semibold">Ask AI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void newChat()}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              + New chat
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close AI chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body: conversations rail + chat */}
        <div className="flex min-h-0 flex-1">
          {railOpen ? (
            <div className="flex w-52 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <span>Conversations</span>
                <button
                  type="button"
                  onClick={toggleRail}
                  className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="Collapse conversations"
                  title="Collapse"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <ul className="flex-1 overflow-y-auto px-1.5 pb-2">
                {conversations.length === 0 ? (
                  <li className="px-2 py-4 text-center text-xs text-zinc-500">No conversations yet.</li>
                ) : (
                  conversations.map((c) => (
                    <li
                      key={c.id}
                      className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                        c.id === activeId
                          ? "bg-zinc-100 dark:bg-zinc-800"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(c.id)}
                        className="flex-1 truncate text-left"
                        title={c.title}
                      >
                        {c.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteConversation(c.id)}
                        className="ml-1.5 shrink-0 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                        aria-label="Delete conversation"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {/* Chat column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 && !loading ? (
                <div className="space-y-3">
                  <p className="text-sm text-zinc-500">Ask anything about your finances. Try:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void submit(s)}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
                    className={`inline-block max-w-[88%] rounded-lg px-3 py-2 text-left text-sm ${
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
                void submit(input);
              }}
              className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about spending, budgets, net worth…"
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
        </div>
      </aside>
    </>
  );
}
