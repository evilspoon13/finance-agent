"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * AI insight for the current spending range. Runs automatically on mount and is
 * served from a server-side cache until spending in this range changes
 * (fingerprint), so repeat views are instant. "Regenerate" forces a refresh.
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

  // First await happens before any setState, so this is safe to call from an
  // effect (no synchronous state update during render commit).
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

  // Auto-run when the range changes (cache makes this cheap on repeat views).
  useEffect(() => {
    // load() only calls setState after its first await (the fetch), so this is
    // an async data fetch, not the synchronous cascade the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  function regenerate() {
    setLoading(true);
    setText(null);
    void load(true);
  }

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI insights</h3>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {updatedAt && !loading ? (
            <span>
              {cached ? "cached" : "updated"} {new Date(updatedAt).toLocaleString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={regenerate}
            disabled={loading}
            className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-foreground hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {loading ? "Analyzing…" : "Regenerate"}
          </button>
        </div>
      </div>

      {loading && !text ? (
        <p className="mt-3 animate-pulse text-sm text-zinc-400">Analyzing this range locally…</p>
      ) : null}
      {text ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {text}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
