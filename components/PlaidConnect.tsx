"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { formatCents } from "@/lib/money";

const STATE_KEY = "plaid_link_state";

export interface AccountDTO {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
}
export interface ItemDTO {
  id: string;
  institutionName: string;
  status: "good" | "login_required" | "error";
  /** Hand-entered institution Plaid can't reach; balances are maintained by SQL. */
  manual?: boolean;
  accounts: AccountDTO[];
}

interface LinkState {
  token: string;
  mode: "new" | "update";
  itemId?: string;
}

const STATUS_STYLE: Record<string, string> = {
  manual: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  good: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  login_required: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/**
 * Single Plaid Link controller for the connections page. Handles new links,
 * per-item reconnect (update mode, used to repair login_required and backfill
 * history), and resuming after an OAuth redirect — all through one
 * usePlaidLink instance so the flows never collide.
 */
export function PlaidConnect({ items }: { items: ItemDTO[] }) {
  const router = useRouter();
  const isOAuthReturn =
    typeof window !== "undefined" && window.location.search.includes("oauth_state_id");

  const [linkState, setLinkState] = useState<LinkState | null>(() => {
    if (isOAuthReturn && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(STATE_KEY);
      return raw ? (JSON.parse(raw) as LinkState) : null;
    }
    return null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const pendingOpen = useRef(false);

  function persist(s: LinkState) {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(s));
    setLinkState(s);
  }

  const startNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      if (!res.ok) throw new Error();
      const { link_token } = (await res.json()) as { link_token: string };
      pendingOpen.current = true;
      persist({ token: link_token, mode: "new" });
    } catch {
      setError("Could not start Plaid Link. Check Plaid credentials.");
    } finally {
      setBusy(false);
    }
  }, []);

  const startUpdate = useCallback(async (itemId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) throw new Error();
      const { link_token } = (await res.json()) as { link_token: string };
      pendingOpen.current = true;
      persist({ token: link_token, mode: "update", itemId });
    } catch {
      setError("Could not start reconnect.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken) => {
      const state = linkState;
      setBusy(true);
      setError(null);
      try {
        if (state?.mode === "update" && state.itemId) {
          const res = await fetch("/api/plaid/item-resync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: state.itemId }),
          });
          if (!res.ok) throw new Error();
          setMsg("Reconnected and resynced.");
        } else {
          // The exchange also pulls the account's full transaction history, so
          // this request can run for a while on a busy account — say so rather
          // than leaving the user on a bare spinner.
          setMsg("Account linked — importing your transaction history…");
          const res = await fetch("/api/plaid/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ public_token: publicToken }),
          });
          if (!res.ok) throw new Error();
          const data = (await res.json()) as {
            imported: number | null;
            sync_failed: boolean;
            replaced: number;
          };
          const replaced = data.replaced > 0 ? " Replaced the previous link for this institution." : "";
          setMsg(
            data.sync_failed
              ? "Account linked, but importing transactions failed — try Sync."
              : `Account linked. Imported ${data.imported ?? 0} transactions.${replaced}`,
          );
        }
        window.localStorage.removeItem(STATE_KEY);
        router.replace("/connections");
        router.refresh();
      } catch {
        setMsg(null);
        setError("Something went wrong finishing the connection.");
      } finally {
        setBusy(false);
      }
    },
    [router, linkState],
  );

  const { open, ready } = usePlaidLink({
    token: linkState?.token ?? null,
    onSuccess,
    ...(isOAuthReturn ? { receivedRedirectUri: window.location.href } : {}),
  });

  // Open once Link is ready, whether triggered by a button or an OAuth return.
  useEffect(() => {
    if (ready && (pendingOpen.current || isOAuthReturn)) {
      pendingOpen.current = false;
      open();
    }
  }, [ready, isOAuthReturn, open]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startNew}
          disabled={busy}
          className="inline-flex w-fit items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Working…" : "Connect an account"}
        </button>
        {msg ? <span className="text-sm text-zinc-500">{msg}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No institutions linked yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{item.institutionName}</h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[item.manual ? "manual" : item.status] ?? STATUS_STYLE.error
                    }`}
                    title={item.manual ? "Entered by hand; not synced from Plaid" : undefined}
                  >
                    {item.manual ? "manual" : item.status}
                  </span>
                  {/* Manual items have no Plaid token, so Link update mode can't repair them. */}
                  {item.manual ? null : (
                    <button
                      type="button"
                      onClick={() => startUpdate(item.id)}
                      disabled={busy}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      title="Repair connection / backfill history (Link update mode)"
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-1 font-medium">Account</th>
                    <th className="py-1 font-medium">Type</th>
                    <th className="py-1 font-medium">Mask</th>
                    <th className="py-1 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {item.accounts.map((a) => (
                    <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5">{a.name}</td>
                      <td className="py-1.5 text-zinc-500">
                        {a.type}
                        {a.subtype ? ` / ${a.subtype}` : ""}
                      </td>
                      <td className="py-1.5 text-zinc-500">{a.mask ? `••${a.mask}` : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {a.currentBalanceCents === null ? "—" : formatCents(a.currentBalanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
