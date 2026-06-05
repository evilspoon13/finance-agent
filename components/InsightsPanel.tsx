"use client";

import { useCallback, useEffect, useState } from "react";
import { Markdown } from "./Markdown";

/**
 * Collapsible AI insight for the current spending range. Runs automatically on
 * mount and is served from a server-side cache until spending in this range
 * changes, so repeat views are instant. Collapsed by default to stay minimal;
 * shows a one-line teaser, expands to the full analysis.
 */
export function InsightsPanel({
  from,
  to,
  account,
}: {
  from?: string;
  to?: string;
  account?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      try {
        const res = await fetch("/api/ai/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, account, force }),
        });
        const data = (await res.json()) as {
          text?: string;
          cached?: boolean;
          updatedAt?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Failed to generate insight.");
        } else {
          setError(null);
          setText(data.text ?? "");
          setCached(Boolean(data.cached));
          setUpdatedAt(data.updatedAt ?? null);
        }
      } catch {
        setError("Request failed.");
      } finally {
        setLoading(false);
      }
    },
    [from, to, account],
  );

  useEffect(() => {
    // load() only calls setState after its first await (the fetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  function regenerate(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    setText(null);
    setOpen(true);
    void load(true);
  }

  const teaser = text ? text.split("\n").find((l) => l.trim().length > 0)?.slice(0, 120) : null;

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          AI insights
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
          {loading && !text ? "Analyzing locally…" : !open && teaser ? teaser + "…" : ""}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {updatedAt && !loading ? (cached ? "cached" : "updated") : ""}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={regenerate}
          onKeyDown={(e) => {
            if (e.key === "Enter") regenerate(e as unknown as React.MouseEvent);
          }}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {loading ? "…" : "Regenerate"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          {text ? (
            <Markdown className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {text}
            </Markdown>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <p className="animate-pulse text-sm text-zinc-400">Analyzing this range locally…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
