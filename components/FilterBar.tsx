"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Generic GET-style filter bar driven by URL search params. Renders an optional
 * search box, account select, category select, and a date range. Updating any
 * control pushes new search params and the server component re-queries.
 */
export function FilterBar({
  accounts = [],
  categories = [],
  showSearch = false,
}: {
  accounts?: FilterOption[];
  categories?: FilterOption[];
  showSearch?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const inputClass =
    "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      {showSearch ? (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Search
          <input
            type="search"
            defaultValue={params.get("search") ?? ""}
            placeholder="merchant or name"
            onChange={(e) => setParam("search", e.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      {accounts.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Account
          <select
            value={params.get("account") ?? ""}
            onChange={(e) => setParam("account", e.target.value)}
            className={inputClass}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {categories.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Category
          <select
            value={params.get("category") ?? ""}
            onChange={(e) => setParam("category", e.target.value)}
            className={inputClass}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        From
        <input
          type="date"
          defaultValue={params.get("from") ?? ""}
          onChange={(e) => setParam("from", e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        To
        <input
          type="date"
          defaultValue={params.get("to") ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          className={inputClass}
        />
      </label>
    </div>
  );
}
