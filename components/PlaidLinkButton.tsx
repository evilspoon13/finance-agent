"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

const LINK_TOKEN_KEY = "plaid_link_token";

/**
 * Fetches a link_token, opens Plaid Link, and on success exchanges the
 * public_token via /api/plaid/exchange, then refreshes the connections list.
 *
 * OAuth institutions (Chase, Capital One, Schwab, Discover in production)
 * redirect the browser to PLAID_REDIRECT_URI mid-flow. On return the page has
 * an `oauth_state_id` query param; we re-initialize Link with the *same* token
 * (persisted in localStorage) plus receivedRedirectUri, and resume automatically.
 */
export function PlaidLinkButton() {
  const router = useRouter();
  const isOAuthReturn =
    typeof window !== "undefined" && window.location.search.includes("oauth_state_id");

  // On an OAuth return, resume with the token persisted before the redirect.
  const [linkToken, setLinkToken] = useState<string | null>(() =>
    isOAuthReturn && typeof window !== "undefined"
      ? window.localStorage.getItem(LINK_TOKEN_KEY)
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOAuthReturn) return; // token already loaded from storage
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        if (!res.ok) throw new Error("link-token request failed");
        const data = (await res.json()) as { link_token: string };
        if (!cancelled) {
          window.localStorage.setItem(LINK_TOKEN_KEY, data.link_token);
          setLinkToken(data.link_token);
        }
      } catch {
        if (!cancelled) setError("Could not start Plaid Link. Check Plaid credentials.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOAuthReturn]);

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
        window.localStorage.removeItem(LINK_TOKEN_KEY);
        // Drop the oauth_state_id param and refresh the list.
        router.replace("/connections");
        router.refresh();
      } catch {
        setError("Failed to link the account.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    ...(isOAuthReturn ? { receivedRedirectUri: window.location.href } : {}),
  });

  // Auto-resume after an OAuth redirect.
  useEffect(() => {
    if (isOAuthReturn && ready) open();
  }, [isOAuthReturn, ready, open]);

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
