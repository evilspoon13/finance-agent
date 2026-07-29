import type { ReactNode } from "react";

/**
 * Collapsible card with a header (title + optional headline figure) that toggles
 * the body. Server-rendered via <details> — no client JS. Shared by the Net Worth
 * and Rewards pages for a consistent, digestible layout.
 */
export function Section({
  title,
  headline,
  defaultOpen = false,
  children,
}: {
  title: string;
  headline?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          <span className="text-zinc-400 transition-transform group-open:rotate-90">▶</span>
          {title}
        </span>
        {headline != null ? <span className="text-sm font-medium tabular-nums">{headline}</span> : null}
      </summary>
      <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">{children}</div>
    </details>
  );
}
