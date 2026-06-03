"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Compact ask box: hands the question off to the full /insights chat. */
export function AskBox() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const question = q.trim();
        if (question) router.push(`/insights?q=${encodeURIComponent(question)}`);
      }}
      className="mb-8 flex gap-2"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask about your spending…"
        className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
      />
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Ask AI
      </button>
    </form>
  );
}
