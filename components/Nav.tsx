"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Net Worth" },
  { href: "/spending", label: "Spending" },
  { href: "/insights", label: "Insights" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/rewards", label: "Rewards" },
  { href: "/connections", label: "Connections" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-4">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
