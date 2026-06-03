"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Triggers POST /api/sync and refreshes the page on completion. */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as { results?: { added: number }[] };
      const total = (data.results ?? []).reduce((n, r) => n + (r.added ?? 0), 0);
      setMsg(res.ok ? `Synced (${total} new transactions).` : "Sync finished with errors.");
      router.refresh();
    } catch {
      setMsg("Sync request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex w-fit items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {msg ? <span className="text-sm text-zinc-500">{msg}</span> : null}
    </div>
  );
}
