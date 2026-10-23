"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";

const KEY = "p2p-review-dismissed";
const EVENT = "p2p-review-dismiss"; // same-tab notification (storage event is cross-tab only)

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * The visible banner. Dismissal is remembered per browser session, keyed by the
 * count — so once you clear or add app payments, it resurfaces with the new
 * number instead of staying hidden forever. Read via useSyncExternalStore so the
 * server snapshot is "dismissed" (no hydration flash) and the client reconciles.
 */
export function P2PReviewBannerClient({ count }: { count: number }) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(KEY) === String(count),
    () => true,
  );

  const dismiss = useCallback(() => {
    sessionStorage.setItem(KEY, String(count));
    window.dispatchEvent(new Event(EVENT));
  }, [count]);

  if (dismissed) return null;

  return (
    <div className="sticky top-[calc(0.5rem+env(safe-area-inset-top))] z-10 mt-2 flex justify-center px-4 sm:top-20">
      <div className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-amber-300/70 bg-amber-50/90 px-4 py-2 text-sm shadow-lg shadow-amber-900/5 backdrop-blur-md dark:border-amber-500/30 dark:bg-amber-950/70">
        <span className="text-amber-900 dark:text-amber-200">
          {count} app payment{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a category
        </span>
        <Link
          href="/review"
          className="rounded-full bg-amber-900 px-3 py-1 text-xs font-medium text-white dark:bg-amber-200 dark:text-amber-950"
        >
          Categorize
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-amber-700/70 hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
