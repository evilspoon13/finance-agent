"use client";

import { useState } from "react";

/**
 * On-demand AI insight for the current spending range. Generation is explicit
 * (a button) rather than on page load, so we don't run the local model — which
 * can take a few seconds — on every view.
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
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setText(null);
    try {
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, account }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to generate insight.");
      } else {
        setText(data.text ?? "");
      }
    } catch {
      setError("Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI insights</h3>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? "Analyzing…" : text ? "Regenerate" : "Generate"}
        </button>
      </div>
      {text ? <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {!text && !error && !loading ? (
        <p className="mt-3 text-sm text-zinc-400">
          Generate a grounded summary of this range — runs locally on Ollama.
        </p>
      ) : null}
    </div>
  );
}
