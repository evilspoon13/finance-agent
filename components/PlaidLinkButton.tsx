"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

/**
 * Fetches a link_token, opens Plaid Link, and on success exchanges the
 * public_token via /api/plaid/exchange, then refreshes the connections list.
 */
export function PlaidLinkButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a fresh link_token on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        if (!res.ok) throw new Error("link-token request failed");
        const data = (await res.json()) as { link_token: string };
        if (!cancelled) setLinkToken(data.link_token);
      } catch {
        if (!cancelled) setError("Could not start Plaid Link. Check Plaid credentials.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!res.ok) throw new Error("exchange failed");
        router.refresh();
      } catch {
        setError("Failed to link the account.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => open()}
        disabled={!ready || !linkToken || busy}
        className="inline-flex w-fit items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Linking…" : "Connect an account"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
